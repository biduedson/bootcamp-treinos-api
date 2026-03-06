import { NotFoundError } from "../errors/intex.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  workoutPlanId: string;
  workoutDayId: string;
  sessionId: string;
  completedAt: string;
}

interface OutputDto {
  id: string;
  completedAt: string;
  startedAt: string;
}

export class UpdateWorkoutSession {
  async execute(dto: InputDto): Promise<OutputDto> {
    const workoutPlan = await prisma.workoutPlan.findUnique({
      where: { id: dto.workoutPlanId },
    });

    if (!workoutPlan || workoutPlan.userId !== dto.userId) {
      throw new NotFoundError("Workout plan not found");
    }

    const workoutDay = await prisma.workoutDay.findUnique({
      where: {
        id: dto.workoutDayId,
        workoutPlanId: dto.workoutPlanId,
      },
    });

    if (!workoutDay) {
      throw new NotFoundError("Workout day not found");
    }

    const Session = await prisma.workoutSession.findUnique({
      where: {
        id: dto.sessionId,
        workoutDayId: dto.workoutDayId,
      },
    });

    if (!Session) {
      throw new NotFoundError("Workout session not found");
    }

    const updatedSession = await prisma.workoutSession.update({
      where: { id: dto.sessionId },
      data: { completedAt: new Date(dto.completedAt) },
    });

    return {
      id: updatedSession.id,
      completedAt: updatedSession.startedAt.toISOString(),
      startedAt: updatedSession.completedAt!.toISOString(),
    };
  }
}
