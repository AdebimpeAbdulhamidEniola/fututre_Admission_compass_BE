import type { CandidateProfile, OLevelResult } from "@prisma/client";

import { prisma } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import type { CreateProfileInput, UpdateProfileInput } from "./candidates.schema.js";

// Matches the frontend mock's exact message (src/lib/api/candidates.ts) — don't use the
// notFound() helper here, it appends " not found" and would mangle this full sentence.
const noProfileYet = () =>
  new ApiError(404, "You have not created a candidate profile yet.", "Not Found");

type ProfileWithResults = CandidateProfile & { oLevelResults: OLevelResult[] };

/** Matches CandidateProfile in the frontend's src/types/domain.ts — strips userId/timestamps/row ids. */
function serializeProfile(profile: ProfileWithResults) {
  return {
    id: profile.id,
    fullName: profile.fullName,
    email: profile.email,
    stateOfOrigin: profile.stateOfOrigin,
    lga: profile.lga,
    schoolLocationState: profile.schoolLocationState,
    utmeScore: profile.utmeScore,
    postUtmeScore: profile.postUtmeScore,
    utmeSubjects: profile.utmeSubjects,
    oLevelResults: profile.oLevelResults.map((r) => ({ subject: r.subject, grade: r.grade })),
    targetCourseId: profile.targetCourseId,
    targetUniversityId: profile.targetUniversityId,
  };
}

export async function createOrReplaceProfile(userId: string, input: CreateProfileInput) {
  const existing = await prisma.candidateProfile.findUnique({ where: { userId } });

  const profile = existing
    ? await prisma.candidateProfile.update({
        where: { userId },
        data: {
          fullName: input.fullName,
          email: input.email,
          stateOfOrigin: input.stateOfOrigin,
          lga: input.lga,
          schoolLocationState: input.schoolLocationState,
          utmeScore: input.utmeScore,
          postUtmeScore: input.postUtmeScore,
          utmeSubjects: input.utmeSubjects,
          targetCourseId: input.targetCourseId,
          targetUniversityId: input.targetUniversityId,
          oLevelResults: {
            deleteMany: {},
            create: input.oLevelResults,
          },
        },
        include: { oLevelResults: true },
      })
    : await prisma.candidateProfile.create({
        data: {
          userId,
          fullName: input.fullName,
          email: input.email,
          stateOfOrigin: input.stateOfOrigin,
          lga: input.lga,
          schoolLocationState: input.schoolLocationState,
          utmeScore: input.utmeScore,
          postUtmeScore: input.postUtmeScore,
          utmeSubjects: input.utmeSubjects,
          targetCourseId: input.targetCourseId,
          targetUniversityId: input.targetUniversityId,
          oLevelResults: { create: input.oLevelResults },
        },
        include: { oLevelResults: true },
      });

  return serializeProfile(profile);
}

export async function getProfileByUserId(userId: string) {
  const profile = await prisma.candidateProfile.findUnique({
    where: { userId },
    include: { oLevelResults: true },
  });
  if (!profile) throw noProfileYet();
  return serializeProfile(profile);
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const existing = await prisma.candidateProfile.findUnique({ where: { userId } });
  if (!existing) throw noProfileYet();

  const { oLevelResults, ...rest } = input;
  const profile = await prisma.candidateProfile.update({
    where: { userId },
    data: {
      ...rest,
      ...(oLevelResults ? { oLevelResults: { deleteMany: {}, create: oLevelResults } } : {}),
    },
    include: { oLevelResults: true },
  });

  return serializeProfile(profile);
}
