import express, { NextFunction, Request, Response } from "express";
import mongoose, { model } from "mongoose";
import { MongoServerError } from "mongodb";
import jwt from "jsonwebtoken";
import "dotenv/config"
import { AsyncLocalStorage } from "node:async_hooks";

const app = express();

function connectDB() {
    mongoose.connect(process.env.MONGO_URI!).then(() => {
        console.log("Connected to MongoDB");
    }).catch((error) => {
        console.log(error);
    })
}
interface CTX {
    user: {
        walletId: string;
        role: string;
    }
}
const ctx = new AsyncLocalStorage<CTX>();

function getCtx() {
    if (!ctx.getStore()) {
        throw createRequestError("Unauthorized", 401, "UnauthorizedError");
    }
    return ctx.getStore()!;
}

function runCtx(store: CTX, fn: () => void) {
    ctx.run(store, fn);
}

function authGuard(req: Request, res: Response, next: NextFunction) {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
            throw createRequestError("Unauthorized", 401, "UnauthorizedError");
        }
        const decoded = jwt.verify(token, "secret") as CTX["user"];
        runCtx({ user: decoded }, () => {
            next();
        });
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw createRequestError("Token expired", 401, "TokenExpiredError");
        }
        if (error instanceof jwt.JsonWebTokenError) {
            throw createRequestError("Invalid token", 401, "InvalidTokenError");
        }
        next(error);
    }
}

function roleGuard(role: string) {
    return (_: Request, __: Response, next: NextFunction) => {
        const { role: userRole } = getCtx().user;
        if (userRole !== role) {
            throw createRequestError(
                `Access denied. Only ${role.toLowerCase()}s can access this resource`,
                403,
                "RoleNotAuthorizedError"
            );
        }
        next();
    }
}

const UserSchema = new mongoose.Schema({
    id: String,
    walletId: { type: String, required: true },
    role: { type: String, enum: ["Talent", "Employee"], required: true },
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    avatar: { type: String, default: "" },
}, { discriminatorKey: "role", collection: "users", timestamps: true, id: false });

UserSchema.index({ walletId: 1, role: 1 }, { unique: true });

UserSchema.set("toJSON", {
    transform(doc, ret) {
        ret.id = ret._id.toString();
        Reflect.deleteProperty(ret, "_id");
        Reflect.deleteProperty(ret, "__v");
        return ret;
    }
})

const UserModel = model("User", UserSchema);
UserModel.discriminator(
    "Talent",
    new mongoose.Schema({
        experienceLevel: { type: String, default: "" },
        privacy: {
            showEarnings: { type: Boolean, default: false },
            publicProfile: { type: Boolean, default: true },
            showProjects: { type: Boolean, default: true },
            showReviews: { type: Boolean, default: true },
            allowDirectContact: { type: Boolean, default: true }
        },
        notificationSettings: {
            emailNotifications: {
                newGigOpportunities: { type: Boolean, default: true },
                paymentUpdates: { type: Boolean, default: true },
                messagesFromClients: { type: Boolean, default: true },
                marketingUpdates: { type: Boolean, default: false }
            },
            pushNotifications: {
                newGigOpportunities: { type: Boolean, default: true },
                paymentUpdates: { type: Boolean, default: true },
                messagesFromClients: { type: Boolean, default: true },
                marketingUpdates: { type: Boolean, default: false }
            }
        },
        location: { type: String, default: "" },
        website: { type: String, default: "" },
        bio: { type: String, default: "" },
        skills: { type: [String], default: [] }
    })
);
UserModel.discriminator("Employee", new mongoose.Schema({ companyName: { type: String, default: "" } }));

const TalentModel = model("Talent");
const EmployeeModel = model("Employee");

app.use(express.json());

app.post("/api/v1/auth", async (req, res, next) => {
    const { walletId, role } = req.body;
    if (!walletId || !role) {
        return res.status(400).json({ message: "Missing walletId or role", name: "" });
    }
    if (!['Talent', 'Employee'].includes(role)) {
        return res.status(400).json({ message: "Invalid role", name: "InvalidRoleError" });
    }
    try {
        const user = role === "Talent" ? await talentAuth(walletId) : await employeeAuth(walletId);
        const token = jwt.sign({ walletId, role }, "secret", { expiresIn: "24h" });
        res.status(200).json({ message: "Authentication successful", data: { user, token } });
    } catch (error) {
        const errMap: Record<string, number> = {
            TalentAlreadyExistsError: 409,
            EmployeeAlreadyExistsError: 409,
        }
        const e = createRequestError(
            (error as Error).message || "Authentication not successful",
            errMap[(error as Error).name],
            (error as Error).name
        )
        next(e);
    }
})

app.use(authGuard);
app.get("/api/v1/profile", async (req, res, next) => {
    const { walletId, role } = getCtx().user;
    const user = await UserModel.findOne({ walletId, role });
    if (!user) {
        throw createRequestError("User not found", 404, "UserNotFoundError");
    }
    res.status(200).json({ message: "User profile fetched successfully", data: user });
})

interface UpdateTalentProfileBody {
    name: string;
    email: string;
    location: string;
    website: string;
    bio: string;
    skills: string[];
    notificationSettings: {
        emailNotifications: {
            newGigOpportunities: boolean;
            paymentUpdates: boolean;
            messagesFromClients: boolean;
            marketingUpdates: boolean;
        };
        pushNotifications: {
            newGigOpportunities: boolean;
            paymentUpdates: boolean;
            messagesFromClients: boolean;
            marketingUpdates: boolean;
        };
    };
    privacy: {
        showEarnings: boolean;
        publicProfile: boolean;
        showProjects: boolean;
        showReviews: boolean;
        allowDirectContact: boolean;
    };
    experienceLevel: string;
}

interface UpdateEmployeeProfileBody {
    name: string;
    email: string;
    location: string;
    website: string;
    bio: string;
    companyName: string;
}

app.patch("/api/v1/profile/talent", roleGuard("Talent"), async (req: Request<object, object, UpdateTalentProfileBody>, res: Response, next) => {
    const { walletId, role } = getCtx().user;
    const user = await TalentModel.findOneAndUpdate(
        { walletId, role },
        req.body,
        { ignoreUndefined: true, new: true, runValidators: true }
    );
    if (!user) {
        throw createRequestError("User not found", 404, "UserNotFoundError");
    }
    res.status(200).json({ message: "Talent profile updated successfully", data: user });
})

app.patch("/api/v1/profile/employee", roleGuard("Employee"), async (req: Request<object, object, UpdateEmployeeProfileBody>, res: Response, next) => {
    const { walletId, role } = getCtx().user;
    const user = await EmployeeModel.findOneAndUpdate(
        { walletId, role },
        req.body,
        { ignoreUndefined: true, new: true, runValidators: true }
    );
    if (!user) {
        throw createRequestError("User not found", 404, "UserNotFoundError");
    }
    res.status(200).json({ message: "Employee profile updated successfully", data: user });
})

class ServiceError extends Error {
    constructor(message: string, errorName: `${string}Error`) {
        super(message);
        this.name = errorName;
    }
}

function createServiceError(message: string, name: `${string}Error`) {
    return new ServiceError(message, name);
}

class RequestError extends Error {
    constructor(message: string, public status: number, public name: string) {
        super(message);
    }
}

function createRequestError(message: string, status: number, name: string) {
    return new RequestError(message, status, name);
}

async function talentAuth(walletId: string) {
    try {
        let user = await TalentModel.findOne({ walletId, role: "Talent" });
        if (!user) {
            user = await TalentModel.create({ walletId, role: "Talent" });
        }
        return user;
    } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
            throw createServiceError("Talent already exists", "TalentAlreadyExistsError")
        }
        throw error;
    }
}

async function employeeAuth(walletId: string) {
    try {
        let user = await EmployeeModel.findOne({ walletId, role: "Employee" });
        if (!user) {
            user = await EmployeeModel.create({ walletId, role: "Employee" });
        }
        return user;
    } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
            throw createServiceError("Employee already exists", "EmployeeAlreadyExistsError")
        }
        throw error;
    }
}

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    const errorMessage = err.message || "Something went wrong. Please try again later.";
    const errorName = err.name || "UnknownError";
    const status = (err as InstanceType<typeof RequestError>).status || 500;
    
    return res.status(status).json({ message: errorMessage, errorName });
})

app.listen(3000, () => {
    connectDB();
    console.log("Server started on port 3000");
});
