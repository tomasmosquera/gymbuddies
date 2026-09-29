import { z } from 'zod';
import { isValidInviteCode, normalizeInviteCode } from '@/lib/domain/inviteCode';
import { DEFAULT_GROUP_TIMEZONE } from '@/constants/timezones';

export const passwordSchema = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres');

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, 'Ingresa tu nombre completo'),
  phone: z.string().trim().min(7, 'Ingresa un número de teléfono válido').optional().or(z.literal('')),
  email: z.string().trim().email('Correo inválido'),
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: z.string().trim().email('Correo inválido'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Ingresa tu nombre completo'),
  phone: z.string().trim().min(7, 'Ingresa un número de teléfono válido').optional().or(z.literal('')),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Ingresa tu contraseña actual'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirma tu nueva contraseña'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Las contraseñas nuevas no coinciden',
    path: ['confirmPassword'],
  });

export const createGroupSchema = z.object({
  name: z.string().trim().min(3, 'El nombre debe tener al menos 3 caracteres').max(60),
  initialDepositAmount: z.number().positive('El monto debe ser mayor a 0'),
  minDaysPerWeek: z.number().int().min(0).max(7),
  penaltyAmount: z.number().min(0),
  weeklyPenaltyCap: z.number().min(0),
  exitFeeAmount: z.number().min(0).default(0),
  enrollmentFeeAmount: z.number().min(0).default(0),
  exitNoticeDays: z.number().int().min(0).default(0),
  requireCheckoutPhoto: z.boolean().default(false),
  minWorkoutMinutes: z.number().int().min(0).default(0),
  adminPaymentInfo: z.string().trim().max(280).optional().or(z.literal('')),
  payoutMode: z.enum(['cooperative', 'league', 'mixed']).default('cooperative'),
  leagueDurationWeeks: z.number().int().min(1).max(104).default(13),
  leagueAutoRenew: z.boolean().default(false),
  leaguePrizeSplits: z
    .array(z.number().min(0))
    .max(10)
    .default([60, 30, 10])
    .refine((splits) => splits.reduce((sum, v) => sum + v, 0) <= 100, {
      message: 'La suma de los porcentajes no puede superar 100%',
    }),
  mixedLeagueSharePercent: z.number().min(0).max(100).default(50),
  descensoRankCount: z.number().int().min(0).max(20).default(0),
  descensoPenaltyAmount: z.number().min(0).default(0),
  gameStartsAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
    .optional()
    .or(z.literal('')),
  timezone: z.string().min(1, 'Selecciona un timezone').default(DEFAULT_GROUP_TIMEZONE),
  isPublic: z.boolean().default(false),
});

export const joinGroupSchema = z.object({
  inviteCode: z
    .string()
    .trim()
    .transform(normalizeInviteCode)
    .refine(isValidInviteCode, 'Código de invitación inválido'),
});

export const walletTransactionSchema = z.object({
  amount: z.number().positive('El monto debe ser mayor a 0'),
  receiptImageUri: z.string().min(1, 'Adjunta un comprobante de la transferencia'),
});

export const ruleProposalSchema = z
  .object({
    minDaysPerWeek: z.number().int().min(0).max(7).optional(),
    penaltyAmount: z.number().min(0).optional(),
    weeklyPenaltyCap: z.number().min(0).optional(),
    exitFeeAmount: z.number().min(0).optional(),
    exitNoticeDays: z.number().int().min(0).optional(),
    requireCheckoutPhoto: z.boolean().optional(),
    minWorkoutMinutes: z.number().int().min(0).optional(),
    payoutMode: z.enum(['cooperative', 'league', 'mixed']).optional(),
    leagueDurationWeeks: z.number().int().min(1).max(104).optional(),
    leagueAutoRenew: z.boolean().optional(),
    leaguePrizeSplits: z
      .array(z.number().min(0))
      .max(10)
      .optional()
      .refine((splits) => !splits || splits.reduce((sum, v) => sum + v, 0) <= 100, {
        message: 'La suma de los porcentajes no puede superar 100%',
      }),
    mixedLeagueSharePercent: z.number().min(0).max(100).optional(),
    leagueCycleStartedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').optional(),
    descensoRankCount: z.number().int().min(0).max(20).optional(),
    descensoPenaltyAmount: z.number().min(0).optional(),
    enrollmentFeeAmount: z.number().min(0).optional(),
  })
  .refine((changes) => Object.values(changes).some((v) => v !== undefined), {
    message: 'Propón al menos un cambio',
  });

export const excuseRequestSchema = z
  .object({
    excuseType: z.enum(['travel', 'medical', 'other']),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida'),
    reason: z.string().trim().max(280).optional().or(z.literal('')),
    proofImageUris: z.array(z.string().min(1)).max(8, 'Máximo 8 fotos').default([]),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'La fecha final debe ser igual o posterior a la inicial',
    path: ['endDate'],
  })
  .refine((v) => v.excuseType === 'other' || v.proofImageUris.length > 0, {
    message: 'Adjunta al menos una prueba (tiquete, recibo de peaje o incapacidad médica)',
    path: ['proofImageUris'],
  });

export const routineExerciseSetSchema = z
  .object({
    targetRepsMin: z.number().int().min(1).max(100),
    targetRepsMax: z.number().int().min(1).max(100),
    targetWeight: z.number().min(0).optional(),
    isFailureTarget: z.boolean().default(false),
  })
  .refine((v) => v.targetRepsMax >= v.targetRepsMin, {
    message: 'El máximo de repeticiones debe ser mayor o igual al mínimo',
    path: ['targetRepsMax'],
  });

export const routineExerciseSchema = z.object({
  exerciseId: z.string().uuid(),
  /** Rest between sets, in whole seconds — the form collects minutes + seconds and combines them. */
  restSeconds: z.number().int().min(0).max(1800).optional(),
  notes: z.string().trim().max(200).optional().or(z.literal('')),
  /** This exercise's own unit — different gym machines read in different units, so it's picked per exercise. */
  unit: z.enum(['kg', 'lbs']).default('kg'),
  sets: z.array(routineExerciseSetSchema).min(1, 'Agrega al menos una serie').max(15, 'Máximo 15 series por ejercicio'),
});

export const routineSchema = z.object({
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(60),
  groupId: z.string().uuid().nullable().default(null),
  exercises: z.array(routineExerciseSchema).min(1, 'Agrega al menos un ejercicio').max(30, 'Máximo 30 ejercicios por rutina'),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type JoinGroupInput = z.infer<typeof joinGroupSchema>;
export type WalletTransactionInput = z.infer<typeof walletTransactionSchema>;
export type RuleProposalInput = z.infer<typeof ruleProposalSchema>;
export type ExcuseRequestInput = z.infer<typeof excuseRequestSchema>;
export type RoutineInput = z.infer<typeof routineSchema>;
export type RoutineExerciseInput = z.infer<typeof routineExerciseSchema>;
export type RoutineExerciseSetInput = z.infer<typeof routineExerciseSetSchema>;
