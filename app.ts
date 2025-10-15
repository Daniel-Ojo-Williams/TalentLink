import express, { NextFunction, Request, Response } from "express";
import mongoose, { model } from "mongoose";
import { MongoServerError } from "mongodb";
import jwt from "jsonwebtoken";
import "dotenv/config"

const app = express();

function connectDB() {
    mongoose.connect(process.env.MONGO_URI!).then(() => {
        console.log("Connected to MongoDB");
    }).catch((error) => {
        console.log(error);
    })
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
UserModel.discriminator("Talent", new mongoose.Schema({ experienceLevel: String }));
UserModel.discriminator("Employee", new mongoose.Schema({}));

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
        res.json({ user, token });
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
        console.log(user)
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
    
    return res.status(status).json({ error: errorMessage, name: errorName });
})

app.listen(3000, () => {
    connectDB();
    console.log("Server started on port 3000");
});
