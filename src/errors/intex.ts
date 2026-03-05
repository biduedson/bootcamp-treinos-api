import z from "zod";

import { WeekDay } from "../generated/prisma/enums.js";

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
