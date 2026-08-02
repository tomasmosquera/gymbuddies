/** Short explanatory text shown under each group-rule field — same idea as PAYOUT_MODE_DESCRIPTIONS, one level down (per field instead of per mode). */
export const RULE_FIELD_HELP = {
  initialDepositAmount: 'Lo que cada miembro debe depositar para activar su cupo en el grupo.',
  minDaysPerWeek: 'Cuántos días a la semana debe entrenar cada miembro para no fallar.',
  penaltyAmount: 'Se descuenta del saldo del miembro por cada día fallado.',
  weeklyPenaltyCap: 'Lo máximo que se le puede cobrar a un miembro en una sola semana, sin importar cuántos días falle.',
  exitFeeAmount: 'Se cobra a quien decide salir del grupo de inmediato, sin avisar con anticipación.',
  exitNoticeDays: 'Días de aviso previo para salir del grupo sin pagar la cuota de salida.',
  requireCheckoutPhoto: 'Pide una segunda foto al terminar el entreno, además de la de llegada.',
  minWorkoutMinutes: 'Minutos mínimos entre la foto inicial y la final para que el entreno cuente (solo aplica si exiges foto final).',
  gameStartsAt: 'Antes de esta fecha nada cuenta para el ranking ni las multas — útil si el grupo se crea antes de empezar a jugar en serio.',
  leagueDurationMonths: 'Cuánto dura cada ciclo antes de repartir el premio — al terminar, el reparto de Liga queda en pausa hasta que el admin inicie uno nuevo.',
  leaguePrizeSplits: 'Qué % del fondo de Liga se lleva cada puesto del ranking al terminar el ciclo.',
  mixedLeagueSharePercent: 'El resto del fondo (100% menos esto) se reparte por igual entre todos, como en Cooperativo.',
  adminPaymentInfo: 'Cómo deben transferirte el dinero los demás miembros (Nequi, Bancolombia, etc.).',
} as const;
