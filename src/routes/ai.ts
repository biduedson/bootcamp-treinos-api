import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  UIMessage,
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
} from "ai";
import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import z from "zod";

import { WeekDay } from "../generated/prisma/enums.js";
import { auth } from "../lib/auth.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";
import { GetUserTrainData } from "../usecases/GetUserTrainData.js";
import { ListWorkoutPlans } from "../usecases/ListWorkoutPlans.js";
import { UpsertUserTrainData } from "../usecases/UpsertUserTrainData.js";

const SYSTEM_PROMPT = [
  "Você é um personal trainer virtual especialista em montagem de planos de treino personalizados.",
  "",
  "Tom: amigável, motivador, linguagem simples, sem jargões técnicos. Seu público principal são pessoas leigas em musculação.",
  "",
  "## Primeira coisa que você DEVE fazer",
  "",
  "SEMPRE chame a tool `getUserTrainData` antes de qualquer interação com o usuário.",
  "",
  "- Se retornar null (usuário sem dados): pergunte nome, peso (kg), altura (cm), idade e % de gordura corporal. Faça perguntas simples e diretas, em uma única mensagem. Após receber os dados, salve com a tool `updateUserTrainData` (converta peso de kg para gramas antes de salvar).",
  "- Se já tiver dados: cumprimente o usuário pelo nome e pergunte como pode ajudar.",
  "",
  "## Como criar um plano de treino",
  "",
  "Antes de criar, pergunte:",
  "1. Qual o objetivo (ex: emagrecimento, hipertrofia, força)",
  "2. Quantos dias por semana pode treinar",
  "3. Se tem alguma restrição física ou lesão",
  "",
  "Faça poucas perguntas, simples e diretas. Depois, use a tool `createWorkoutPlan`.",
  "",
  "### Divisão de treinos por dias disponíveis:",
  "- 2-3 dias: Full Body ou ABC (A: Peito+Tríceps | B: Costas+Bíceps | C: Pernas+Ombros)",
  "- 4 dias: Upper/Lower (recomendado) ou ABCD (A: Peito+Tríceps | B: Costas+Bíceps | C: Pernas | D: Ombros+Abdômen)",
  "- 5 dias: PPLUL — Push/Pull/Legs + Upper/Lower",
  "- 6 dias: PPL 2x — Push/Pull/Legs repetido",
  "",
  "### Princípios de montagem:",
  "- Músculos sinérgicos juntos (peito+tríceps, costas+bíceps)",
  "- Exercícios compostos primeiro, isoladores depois",
  "- 4 a 8 exercícios por sessão",
  "- 3-4 séries por exercício; 8-12 reps (hipertrofia), 4-6 reps (força)",
  "- Evitar treinar o mesmo grupo muscular em dias consecutivos",
  "- Nomes descritivos para cada dia (ex: 'Superior A - Peito e Costas', 'Descanso')",
  "",
  "### Regras de estrutura do plano:",
  "- O plano DEVE ter exatamente 7 dias (MONDAY a SUNDAY)",
  "- Dias sem treino: isRest: true, exercises: [], estimatedDurationInSeconds: 0",
  "- SEMPRE fornecer coverImageUrl para cada dia:",
  "  - Dias superiores (peito, costas, ombros, bíceps, tríceps, push, pull, upper, full body):",
  "    Alterne entre: https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO3y8pQ6GBg8iqe9pP2JrHjwd1nfKtVSQskI0v e https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOW3fJmqZe4yoUcwvRPQa8kmFprzNiC30hqftL",
  "  - Dias inferiores (pernas, glúteos, quadríceps, posterior, panturrilha, legs, lower):",
  "    Alterne entre: https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOgCHaUgNGronCvXmSzAMs1N3KgLdE5yHT6Ykj e https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO85RVu3morROwZk5NPhs1jzH7X8TyEvLUCGxY",
  "  - Dias de descanso: usar imagem de superior",
  "",
  "## Comportamento geral",
  "- Respostas curtas e objetivas",
  "- Nunca use jargões ou termos técnicos sem explicar",
].join("\n");

export const aiRoutes = async (app: FastifyInstance) => {
  app.withTypeProvider().route({
    method: "POST",
    url: "/chat",
    schema: {
      tags: ["AI"],
      summary: "Chat with the AI personal trainer",
    },
    handler: async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session) {
        return reply.status(401).send({
          error: "Unauthorized",
          code: "UNAUTHORIZED",
        });
      }

      const userId = session.user.id;
      const body = request.body as { messages: UIMessage[] };
      const messages = await convertToModelMessages(body.messages);

      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });

      const result = streamText({
        model: google("gemini-2.0-flash"),
        system: SYSTEM_PROMPT,
        messages,
        stopWhen: stepCountIs(5),
        tools: {
          getUserTrainData: tool({
            description:
              "Retrieves the authenticated user train data. Always call this first before any user interaction.",
            inputSchema: z.object({}),
            execute: async () => {
              const useCase = new GetUserTrainData();
              return useCase.execute({ userId });
            },
          }),
          updateUserTrainData: tool({
            description:
              "Creates or updates the authenticated user train data.",
            inputSchema: z.object({
              weightInGrams: z
                .number()
                .describe(
                  "User weight in grams (convert from kg by multiplying by 1000)",
                ),
              heightInCentimeters: z
                .number()
                .describe("User height in centimeters"),
              age: z.number().describe("User age in years"),
              bodyFatPercentage: z
                .number()
                .describe(
                  "Body fat percentage as a decimal (e.g. 0.15 for 15%)",
                ),
            }),
            execute: async (params) => {
              const useCase = new UpsertUserTrainData();
              return useCase.execute({ userId, ...params });
            },
          }),
          getWorkoutPlans: tool({
            description: "Lists all workout plans for the authenticated user.",
            inputSchema: z.object({}),
            execute: async () => {
              const useCase = new ListWorkoutPlans();
              return useCase.execute({ userId });
            },
          }),
          createWorkoutPlan: tool({
            description:
              "Creates a new workout plan for the authenticated user. The plan must have exactly 7 days (MONDAY to SUNDAY).",
            inputSchema: z.object({
              name: z.string().describe("Name of the workout plan"),
              workoutDays: z.array(
                z.object({
                  name: z.string().describe("Name of the workout day"),
                  weekDay: z
                    .enum(WeekDay)
                    .describe("Day of the week for this workout"),
                  isRest: z.boolean().describe("Whether this is a rest day"),
                  estimatedDurationInSeconds: z
                    .number()
                    .describe(
                      "Estimated duration of the workout in seconds (0 for rest days)",
                    ),
                  coverImageUrl: z
                    .string()
                    .url()
                    .describe(
                      "Cover image URL for the workout day. Always required.",
                    ),
                  exercises: z.array(
                    z.object({
                      name: z.string().describe("Exercise name"),
                      order: z
                        .number()
                        .describe(
                          "Order of the exercise in the session (starts at 0)",
                        ),
                      sets: z.number().describe("Number of sets"),
                      reps: z.number().describe("Number of repetitions"),
                      restTimeInSeconds: z
                        .number()
                        .describe("Rest time between sets in seconds"),
                    }),
                  ),
                }),
              ),
            }),
            execute: async (params) => {
              const useCase = new CreateWorkoutPlan();
              return useCase.execute({ userId, ...params });
            },
          }),
        },
      });

      reply.raw.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      });

      const reader = result.textStream.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            reply.raw.end();
            break;
          }
          reply.raw.write(value);
        }
      };
      await pump();
      return;
    },
  });
};
