# Gym Buddies

App móvil (React Native + Expo) para que un grupo de amigos se haga cumplir mutuamente ir al gimnasio. Cada quien hace un depósito inicial en $COP (por fuera de la app, entre amigos), y cada día que falten al mínimo semanal de gym pactado por el grupo se les descuenta una penalización de su saldo. La prueba de asistencia es una foto tomada **desde la cámara de la app** (nunca de la galería), con ubicación GPS y fecha/hora incrustadas en la imagen. Cambiar las reglas del grupo (días mínimos, monto de penalización, días de vacaciones) requiere mayoría de votos de los miembros.

## Stack

- **App**: Expo (React Native) + TypeScript + `expo-router`
- **Backend**: [Supabase](https://supabase.com) — Postgres + Auth + Storage + Row Level Security + `pg_cron`
- **Sin pasarela de pagos**: las transferencias ($COP) se hacen por fuera de la app (Nequi, Bancolombia, etc.); la app solo registra el comprobante y el admin del grupo confirma manualmente.

## Estructura del proyecto

```
app/                    # Pantallas (expo-router, enrutamiento por archivos)
  (auth)/                 sign-in, sign-up
  (onboarding)/            create-group, join-group, deposit
  (app)/                   tabs: home, checkin, wallet, rules, profile (+ admin)
  group-select.tsx
src/
  lib/domain/             Lógica de negocio pura (sin dependencias de React Native/Supabase) — testeada
  lib/supabase/           Cliente de Supabase, tipos generados, helpers de Storage
  lib/validation/         Esquemas Zod para formularios
  hooks/                  Hooks de datos (auth, grupo activo, check-ins, wallet, votación, etc.)
  state/                  Stores de Zustand (sesión, grupo activo, borrador de check-in)
  components/ui/          Componentes visuales reutilizables
supabase/
  migrations/             Esquema SQL completo, RLS, triggers, funciones, cron (0001–0011)
  functions/               Edge Function opcional para notificaciones push
tests/domain/             Pruebas unitarias de la lógica pura
```

## Cómo funciona el modelo de negocio

1. **Crear/unirse a un grupo**: el admin define días mínimos por semana, penalización por día fallado, días de vacaciones al mes permitidos, y el depósito inicial requerido.
2. **Depósito inicial**: cada miembro (incluido el admin) transfiere el depósito por fuera de la app y sube el comprobante. El admin lo confirma manualmente. Solo entonces el miembro puede hacer check-ins.
3. **Check-in diario**: se toma una foto **desde la cámara de la app** (la galería está bloqueada a propósito). El GPS debe estar activo antes de habilitar el disparador. La fecha/hora y ubicación quedan incrustadas visualmente en la foto antes de subirla.
4. **Evaluación semanal automática**: cada lunes a las 00:00 (hora de Bogotá), un job de `pg_cron` calcula, por cada miembro, cuántos días le faltaron esa semana (descontando los días de vacaciones usados) y descuenta la penalización correspondiente de su saldo.
5. **Recarga**: cuando el saldo llega a cero, el miembro debe recargar (mismo flujo de comprobante + confirmación del admin) antes de poder seguir haciendo check-ins que cuenten.
6. **Cambios de reglas**: el admin propone un cambio; cada miembro activo tiene un voto; se aprueba con mayoría simple. La votación se resuelve apenas se alcanza mayoría matemática (o se cierra a las 72 horas). El cambio aprobado entra en vigor el lunes siguiente, después de evaluar la semana en curso con las reglas anteriores.

## Configurar tu propio proyecto de Supabase (gratis)

La app viene lista con todo el esquema de base de datos, pero necesitas tu propio proyecto de Supabase para probarla de verdad.

1. Crea una cuenta gratis en [supabase.com](https://supabase.com) y un nuevo proyecto.
2. En **Project Settings → API**, copia la **Project URL** y la **anon public key**.
3. Copia `.env.example` a `.env` y pega esos valores:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
   ```
4. Instala la [CLI de Supabase](https://supabase.com/docs/guides/cli) y enlaza tu proyecto:
   ```
   npx supabase login
   npx supabase link --project-ref <tu-project-ref>
   ```
5. Aplica las migraciones (crea todas las tablas, políticas de seguridad, funciones y el cron semanal):
   ```
   npx supabase db push
   ```
6. En el dashboard de Supabase, activa las extensiones `pg_cron` y `pg_net` si no están activas (**Database → Extensions**) — la migración `0011_pg_cron.sql` las necesita para el job semanal.
7. (Opcional) Regenera los tipos TypeScript desde tu esquema real:
   ```
   npx supabase gen types typescript --linked > src/lib/supabase/types.ts
   ```
   No es obligatorio: los tipos ya incluidos en el repo fueron escritos a mano para calzar exactamente con las migraciones.

### Notificaciones push (opcional)

`supabase/functions/weekly-evaluation` envía una notificación push cuando alguien queda en `needs_recharge`. No está conectada por defecto porque requiere desplegar la Edge Function y programarla con `pg_net` (ver comentarios dentro del archivo). El job semanal principal (el que sí descuenta saldos) **no depende de esto** — corre directo en SQL vía `pg_cron`.

## Correr la app

```
npm install
npm run start
```

Escanea el código QR con la app **Expo Go** en tu celular (necesitas un dispositivo físico para probar cámara y GPS — el simulador de iOS no tiene cámara real, y el emulador de Android solo simula una cámara falsa).

## Verificación / pruebas

Lo que se puede correr en cualquier entorno (incluido este sandbox, sin dispositivo ni proyecto Supabase real):

```
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # jest — lógica pura de negocio (fechas, votación, evaluación semanal, códigos de invitación)
```

`src/lib/domain/*.ts` reimplementa en TypeScript puro (sin dependencias) la misma lógica que vive en SQL (`supabase/migrations/0007_functions_triggers.sql` y `0008_rpcs.sql`), para poder testearla sin una base de datos real. El SQL es la fuente de verdad autoritativa; si cambias una regla de negocio, actualiza ambos lados.

### Lo que falta verificar manualmente

No se pudo ejecutar en este entorno (sin dispositivo físico, sin Docker/Supabase local, sin cuenta de Supabase real):

- [ ] Captura real de cámara y bloqueo de GPS en un dispositivo
- [ ] Que el overlay de fecha/ubicación quede correctamente incrustado en la foto final
- [ ] Políticas RLS de extremo a extremo contra un proyecto Supabase real
- [ ] Que el job de `pg_cron` corra y descuente saldos correctamente
- [ ] Flujo completo: crear grupo → unirse con código → depositar → confirmar como admin → check-in → recarga → proponer y votar un cambio de reglas

## Limitaciones conocidas (MVP)

- El bloqueo "solo cámara" es una medida de producto (no se usa `expo-image-picker` en el flujo de check-in), no una garantía criptográfica — alguien podría, en teoría, mostrarle la cámara una foto de una foto. Para un grupo de amigos es suficiente disuasión.
- Los tipos de `src/lib/supabase/types.ts` están escritos a mano para calzar con las migraciones; si el esquema cambia, hay que actualizarlos a mano o regenerarlos con la CLI de Supabase.
- Colombia no tiene horario de verano, así que toda la lógica de fechas asume `America/Bogota` como UTC-5 fijo (tanto en SQL como en `src/lib/domain/dateUtils.ts`).
