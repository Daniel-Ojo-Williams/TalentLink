"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importStar(require("mongoose"));
const mongodb_1 = require("mongodb");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
require("dotenv/config");
const app = (0, express_1.default)();
function connectDB() {
    mongoose_1.default.connect(process.env.MONGO_URI).then(() => {
        console.log("Connected to MongoDB");
    }).catch((error) => {
        console.log(error);
    });
}
const UserSchema = new mongoose_1.default.Schema({
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
});
const UserModel = (0, mongoose_1.model)("User", UserSchema);
UserModel.discriminator("Talent", new mongoose_1.default.Schema({ experienceLevel: String }));
UserModel.discriminator("Employee", new mongoose_1.default.Schema({}));
const TalentModel = (0, mongoose_1.model)("Talent");
const EmployeeModel = (0, mongoose_1.model)("Employee");
app.use(express_1.default.json());
app.post("/api/v1/auth", (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const { walletId, role } = req.body;
    if (!walletId || !role) {
        return res.status(400).json({ message: "Missing walletId or role", name: "" });
    }
    if (!['Talent', 'Employee'].includes(role)) {
        return res.status(400).json({ message: "Invalid role", name: "InvalidRoleError" });
    }
    try {
        const user = role === "Talent" ? yield talentAuth(walletId) : yield employeeAuth(walletId);
        const token = jsonwebtoken_1.default.sign({ walletId, role }, "secret", { expiresIn: "24h" });
        res.json({ user, token });
    }
    catch (error) {
        const errMap = {
            TalentAlreadyExistsError: 409,
            EmployeeAlreadyExistsError: 409,
        };
        const e = createRequestError(error.message || "Authentication not successful", errMap[error.name], error.name);
        next(e);
    }
}));
class ServiceError extends Error {
    constructor(message, errorName) {
        super(message);
        this.name = errorName;
    }
}
function createServiceError(message, name) {
    return new ServiceError(message, name);
}
class RequestError extends Error {
    constructor(message, status, name) {
        super(message);
        this.status = status;
        this.name = name;
    }
}
function createRequestError(message, status, name) {
    return new RequestError(message, status, name);
}
function talentAuth(walletId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let user = yield TalentModel.findOne({ walletId, role: "Talent" });
            if (!user) {
                user = yield TalentModel.create({ walletId, role: "Talent" });
            }
            return user;
        }
        catch (error) {
            if (error instanceof mongodb_1.MongoServerError && error.code === 11000) {
                throw createServiceError("Talent already exists", "TalentAlreadyExistsError");
            }
            throw error;
        }
    });
}
function employeeAuth(walletId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            let user = yield EmployeeModel.findOne({ walletId, role: "Employee" });
            console.log(user);
            if (!user) {
                user = yield EmployeeModel.create({ walletId, role: "Employee" });
            }
            return user;
        }
        catch (error) {
            if (error instanceof mongodb_1.MongoServerError && error.code === 11000) {
                throw createServiceError("Employee already exists", "EmployeeAlreadyExistsError");
            }
            throw error;
        }
    });
}
app.use((err, req, res, next) => {
    const errorMessage = err.message || "Something went wrong. Please try again later.";
    const errorName = err.name || "UnknownError";
    const status = err.status || 500;
    return res.status(status).json({ error: errorMessage, name: errorName });
});
app.listen(3000, () => {
    connectDB();
    console.log("Server started on port 3000");
});
