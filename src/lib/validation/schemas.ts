import { z } from 'zod';
import { isValidInviteCode, normalizeInviteCode } from '@/lib/domain/inviteCode';

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, 'Ingresa tu nombre completo'),
  phone: z.string().trim().min(7, 'Ingresa un número de teléfono válido').optional().or(z.literal('')),
  email: z.string().trim().email('Correo inválido'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres'),
});

export const signInSchema = z.object({
  email: z.string().trim().email('Correo inválido'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(3, 'El nombre debe tener al menos 3 caracteres').max(60),
  initialDepositAmount: z.number().positive('El monto debe ser mayor a 0'),
  minDaysPerWeek: z.number().int().min(0).max(7),
  penaltyAmount: z.number().min(0),
  weeklyPenaltyCap: z.number().min(0),
  exitFeeAmount: z.number().min(0).default(0),
  exitNoticeDays: z.number().int().min(0).default(0),
  adminPaymentInfo: z.string().trim().max(280).optional().or(z.literal('')),
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
    proofImageUri: z.string().min(1).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'La fecha final debe ser igual o posterior a la inicial',
    path: ['endDate'],
  })
  .refine((v) => v.excuseType === 'other' || !!v.proofImageUri, {
    message: 'Adjunta una prueba (tiquete, recibo de peaje o incapacidad médica)',
    path: ['proofImageUri'],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type JoinGroupInput = z.infer<typeof joinGroupSchema>;
export type WalletTransactionInput = z.infer<typeof walletTransactionSchema>;
export type RuleProposalInput = z.infer<typeof ruleProposalSchema>;
export type ExcuseRequestInput = z.infer<typeof excuseRequestSchema>;
