import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
}

interface OutputDto {
  userId: string;
  userName: string;
  weightInGrams: number;
  heightInCentimeters: number;
  age: number;
  bodyFatPercentage: number;
}

export class GetUserTrainData {
  async execute(dto: InputDto): Promise<OutputDto | null> {
    const trainData = await prisma.userTrainData.findUnique({
      where: { userId: dto.userId },
      include: { user: { select: { name: true } } },
    });

    if (!trainData) return null;

    return {
      userId: trainData.userId,
      userName: trainData.user.name,
      weightInGrams: trainData.weightInGrams,
      heightInCentimeters: trainData.heightInCentimeters,
      age: trainData.age,
      bodyFatPercentage: trainData.bodyFatPercentage,
    };
  }
}
