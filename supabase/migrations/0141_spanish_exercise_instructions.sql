-- ============================================================================
-- Spanish exercise instructions + supplementary muscle info, sourced from
-- https://github.com/hasaneyldrm/exercises-dataset's data/exercises.json —
-- explicitly MIT-licensed (its own README/LICENSE: "Code, tooling, dataset
-- structure, and instruction text are released under the MIT License").
-- Only the MIT-covered fields are used here: instruction_steps.es,
-- muscle_group, secondary_muscles, target. The repo's images/GIFs are
-- separately © Gym visual and are NOT used anywhere in this migration or
-- this app.
--
-- Matched to our own 81 exercises by name + equipment (see the
-- one-off matching script used to build this list — not itself part of the
-- app, not committed). instructions is REPLACED with the Spanish steps
-- (this app is Spanish-first; the WorkoutX originals were English-only).
-- secondary_muscles is only ADDED to, never replaced — existing entries are
-- kept, new ones from this source are appended, de-duplicated
-- case-insensitively.
-- ============================================================================

-- Arnold Press (Dumbbell) <- "dumbbell arnold press"
update exercises set
  instructions = ARRAY['Siéntate en un banco con respaldo y sujeta una mancuerna en cada mano a la altura del hombro, con las palmas hacia tu cuerpo y los codos flexionados.', 'Empuja las mancuernas hacia arriba hasta que los brazos estén completamente extendidos y las palmas miren hacia adelante.', 'Rota las muñecas mientras levantas, de modo que las palmas miren hacia adelante en la parte alta del movimiento.', 'Haz una pausa breve en la parte alta, luego baja lentamente las mancuernas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Triceps', 'Upper Chest', 'Delts']::text[]
where slug = 'arnold_press';

-- Back Extension <- "lever back extension"
update exercises set
  instructions = ARRAY['Ajusta la máquina según el tamaño de tu cuerpo y tu rango de movimiento.', 'Siéntate en la máquina con la espalda apoyada en la almohadilla y los pies asegurados.', 'Coloca las manos en las asas o en las barras de agarre.', 'Activa el core e inclínate lentamente hacia adelante, permitiendo que la espalda se redondee ligeramente.', 'Haz una pausa breve en la posición baja, sintiendo un estiramiento en la zona lumbar.', 'Usando los músculos de la espalda, levanta lentamente el torso de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Glutes', 'Hamstrings', 'Spine']::text[]
where slug = 'back_extension';

-- Bench Dip <- "bench dip (knees bent)"
update exercises set
  instructions = ARRAY['Siéntate en el borde de un banco o silla con las manos sujetando el borde junto a las caderas.', 'Desliza los glúteos fuera del banco y estira las piernas frente a ti, manteniendo los talones en el suelo.', 'Flexiona los codos y baja el cuerpo hacia el suelo, manteniendo la espalda cerca del banco.', 'Haz una pausa por un momento en la parte inferior, luego empuja tu cuerpo de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Chest', 'Shoulders', 'Triceps']::text[]
where slug = 'bench_dips';

-- Bench Press (Barbell) <- "barbell bench press"
update exercises set
  instructions = ARRAY['Túmbate sobre un banco con los pies apoyados en el suelo y la espalda presionada contra el banco.', 'Agarra la barra con un agarre pronado un poco más ancho que la separación de los hombros.', 'Levanta la barra del soporte y sostenla directamente sobre el pecho con los brazos completamente extendidos.', 'Baja la barra lentamente hacia el pecho, manteniendo los codos pegados al cuerpo.', 'Haz una pausa breve cuando la barra toque el pecho.', 'Empuja la barra de vuelta a la posición inicial extendiendo los brazos.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Triceps', 'Shoulders', 'Pectorals']::text[]
where slug = 'bench_press';

-- Bench Press (Dumbbell) <- "dumbbell bench press"
update exercises set
  instructions = ARRAY['Túmbate sobre un banco con los pies apoyados en el suelo y la espalda presionada contra el banco.', 'Sujeta una mancuerna en cada mano, con las palmas hacia adelante y los brazos extendidos por encima del pecho.', 'Baja lentamente las mancuernas hacia los lados del pecho, manteniendo los codos en un ángulo de 90 grados.', 'Haz una pausa breve, luego empuja las mancuernas de vuelta hacia arriba hasta la posición inicial, extendiendo completamente los brazos.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Triceps', 'Shoulders', 'Pectorals']::text[]
where slug = 'dumbbell_bench_press';

-- Bent Over Row (Barbell) <- "barbell bent over row"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros y las rodillas ligeramente flexionadas.', 'Inclínate hacia delante desde las caderas manteniendo la espalda recta y el pecho elevado.', 'Agarra la barra con un agarre pronado, con las manos un poco más separadas que el ancho de los hombros.', 'Tira de la barra hacia la parte inferior del pecho retrayendo los omóplatos y contrayendo los músculos de la espalda.', 'Haz una pausa breve en la parte alta y luego baja lentamente la barra de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Upper Back']::text[]
where slug = 'barbell_row';

-- Bent Over Row (Dumbbell) <- "dumbbell bent over row"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros, las rodillas ligeramente flexionadas, y sujeta una mancuerna en cada mano con las palmas hacia tu cuerpo.', 'Inclínate hacia adelante desde las caderas, manteniendo la espalda recta y el core activado.', 'Deja que los brazos cuelguen rectos hacia el suelo, con los codos ligeramente flexionados.', 'Tira de las mancuernas hacia arriba, hacia el pecho, apretando los omóplatos entre sí.', 'Haz una pausa breve en la parte alta, luego baja lentamente las mancuernas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Upper Back']::text[]
where slug = 'dumbbell_row';

-- Burpee <- "burpee"
update exercises set
  instructions = ARRAY['Comienza de pie con los pies separados a la altura de los hombros.', 'Baja el cuerpo hacia una posición de sentadilla flexionando las rodillas y colocando las manos en el suelo frente a ti.', 'Lleva los pies hacia atrás de una patada hasta una posición de flexión de brazos.', 'Realiza una flexión de brazos, manteniendo el cuerpo en línea recta.', 'Salta con los pies de vuelta a la posición de sentadilla.', 'Salta hacia arriba explosivamente, llevando los brazos por encima de la cabeza.', 'Aterriza suavemente y baja de inmediato a una posición de sentadilla para comenzar la siguiente repetición.']::text[],
  secondary_muscles = ARRAY['Quadriceps', 'Hamstrings', 'Calves', 'Shoulders', 'Chest', 'Cardiovascular System']::text[]
where slug = 'burpees';

-- Cable Curl <- "cable curl"
update exercises set
  instructions = ARRAY['Ponte de pie frente a la máquina de cable con los pies separados a la altura de los hombros.', 'Sujeta el accesorio del cable con agarre supino, palmas hacia arriba.', 'Mantén los codos cerca de los costados y los brazos superiores quietos.', 'Exhala y flexiona el accesorio del cable hacia los hombros, contrayendo los bíceps.', 'Haz una pausa breve en la parte más alta del movimiento, contrayendo los bíceps.', 'Inhala y baja lentamente el accesorio del cable de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Forearms', 'Biceps']::text[]
where slug = 'cable_curl';

-- Calf Press (Machine) <- "lever calf press"
update exercises set
  instructions = ARRAY['Ajusta el asiento de la máquina de palanca de modo que los hombros queden alineados con la almohadilla de la palanca.', 'Coloca los dedos de los pies sobre la almohadilla de la palanca, con los talones colgando fuera del borde.', 'Sujeta las asas o los soportes laterales para mayor estabilidad.', 'Empuja la almohadilla de la palanca hacia abajo extendiendo los tobillos, contrayendo los músculos de las pantorrillas.', 'Haz una pausa por un momento en la parte baja del movimiento.', 'Vuelve lentamente a la posición inicial dejando que los talones se eleven de nuevo.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hamstrings', 'Calves']::text[]
where slug = 'leg_press_calf_raise';

-- Chest Dip <- "chest dip"
update exercises set
  instructions = ARRAY['Colócate en las barras paralelas con los brazos completamente extendidos y el cuerpo recto.', 'Baja el cuerpo flexionando los codos hasta que los hombros queden por debajo de los codos.', 'Empújate de vuelta hacia arriba a la posición inicial extendiendo los brazos.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Triceps', 'Shoulders', 'Pectorals']::text[]
where slug = 'chest_dips';

-- Chest Press (Machine) <- "lever chest press"
update exercises set
  instructions = ARRAY['Ajusta la altura del asiento y colócate en la máquina con la espalda totalmente apoyada en la almohadilla.', 'Sujeta las asas con un agarre prono y coloca los codos en un ángulo de 90 grados.', 'Empuja las asas hacia adelante hasta que los brazos queden completamente extendidos, exhalando durante el movimiento.', 'Haz una pausa breve al final del movimiento, luego vuelve lentamente a la posición inicial, inhalando mientras lo haces.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Triceps', 'Shoulders', 'Pectorals']::text[]
where slug = 'chest_press_machine';

-- Chin Up <- "chin-up"
update exercises set
  instructions = ARRAY['Cuélgate de una barra de dominadas con las palmas mirando hacia ti y las manos separadas a la altura de los hombros.', 'Activa el core y tira de tu cuerpo hacia arriba, hacia la barra, guiando con el pecho.', 'Continúa subiendo hasta que la barbilla quede por encima de la barra.', 'Haz una pausa por un momento en la parte superior, luego baja lentamente el cuerpo de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Lats']::text[]
where slug = 'chin_ups';

-- Clean (Barbell) <- "dumbbell clean"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros, sujetando una mancuerna en cada mano con un agarre prono.', 'Flexiona las rodillas y baja las caderas hacia una posición de sentadilla, manteniendo la espalda recta y el pecho elevado.', 'Extiende las caderas y las rodillas de forma explosiva, empujando con los talones para saltar del suelo.', 'Mientras saltas, encoge los hombros y tira de las mancuernas hacia arriba, hacia los hombros, manteniéndolas cerca del cuerpo.', 'Atrapa las mancuernas a la altura de los hombros, con los codos apuntando hacia adelante y las palmas hacia arriba.', 'Baja las mancuernas de vuelta a la posición inicial invirtiendo el movimiento.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Glutes', 'Quadriceps', 'Calves', 'Hamstrings']::text[]
where slug = 'clean';

-- Close Grip Bench Press (Barbell) <- "barbell close-grip bench press"
update exercises set
  instructions = ARRAY['Túmbate sobre un banco con los pies apoyados en el suelo y la espalda presionada contra el banco.', 'Agarra la barra con un agarre cerrado, un poco más estrecho que el ancho de los hombros.', 'Saca la barra del soporte y bájala lentamente hacia el pecho, manteniendo los codos cerca del cuerpo.', 'Haz una pausa breve cuando la barra toque el pecho.', 'Empuja la barra de vuelta a la posición inicial, extendiendo completamente los brazos.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Chest', 'Shoulders', 'Triceps']::text[]
where slug = 'close_grip_bench_press';

-- Concentration Curl (Dumbbell) <- "dumbbell concentration curl"
update exercises set
  instructions = ARRAY['Siéntate en un banco con las piernas separadas y una mancuerna en una mano, apoyando el codo en la parte interna del muslo.', 'Extiende completamente el brazo y sujeta la mancuerna con un agarre supino.', 'Manteniendo el brazo superior quieto, exhala y flexiona el peso hacia el hombro mientras contraes el bíceps.', 'Continúa levantando la mancuerna hasta que el bíceps esté completamente contraído y la mancuerna esté a la altura del hombro.', 'Mantén la posición contraída durante una breve pausa mientras aprietas los bíceps.', 'Inhala y baja lentamente la mancuerna de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado, luego cambia de brazo.']::text[],
  secondary_muscles = ARRAY['Forearms', 'Biceps']::text[]
where slug = 'concentration_curl';

-- Cross-Body Hammer Curl (Dumbbell) <- "dumbbell cross body hammer curl"
update exercises set
  instructions = ARRAY['Ponte de pie con una mancuerna en cada mano, con las palmas hacia tu cuerpo.', 'Mantén los codos cerca del torso y los brazos superiores quietos.', 'Exhala y flexiona los brazos contrayendo los bíceps, llevando las mancuernas a través del cuerpo hacia el hombro opuesto.', 'Continúa levantando las mancuernas hasta que los bíceps estén completamente contraídos y las mancuernas estén a la altura de los hombros.', 'Mantén la posición contraída durante una breve pausa mientras aprietas los bíceps.', 'Inhala y comienza a bajar lentamente las mancuernas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Forearms', 'Biceps']::text[]
where slug = 'dumbbell_cross_body_hammer_curl';

-- Crunch <- "crunch (hands overhead)"
update exercises set
  instructions = ARRAY['Túmbate sobre tu espalda con las rodillas flexionadas y los pies apoyados en el suelo.', 'Extiende los brazos rectos por encima de la cabeza.', 'Activando el abdomen, levanta la parte superior del cuerpo del suelo, flexionándote hacia adelante en dirección a las rodillas.', 'Haz una pausa por un momento en la parte superior, luego baja lentamente la parte superior del cuerpo de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hip Flexors', 'Abs']::text[]
where slug = 'crunch';

-- Deadlift (Barbell) <- "barbell deadlift"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros y la barra en el suelo frente a ti.', 'Flexiona las rodillas y las caderas para bajar el torso y agarra la barra con un agarre pronado, con las manos un poco más separadas que el ancho de los hombros.', 'Mantén la espalda recta y el pecho elevado mientras empujas con los talones para levantar la barra del suelo, extendiendo las caderas y las rodillas.', 'Al ponerte de pie, aprieta los glúteos y mantén el core activado.', 'Baja la barra de vuelta al suelo flexionando las caderas y las rodillas, manteniendo la espalda recta.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hamstrings', 'Lower Back', 'Glutes']::text[]
where slug = 'deadlift';

-- Decline Bench Press (Barbell) <- "barbell decline bench press"
update exercises set
  instructions = ARRAY['Túmbate en un banco declinado con los pies sujetos y la cabeza más baja que las caderas.', 'Agarra la barra con un agarre pronado un poco más ancho que la separación de los hombros.', 'Saca la barra del soporte y bájala lentamente hacia el pecho, manteniendo los codos pegados al cuerpo.', 'Haz una pausa breve en la parte baja y luego empuja la barra de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Triceps', 'Shoulders', 'Pectorals']::text[]
where slug = 'decline_bench_press';

-- Elevated Seated Row, Rope (Cable) <- "cable rope elevated seated row"
update exercises set
  instructions = ARRAY['Siéntate en el asiento elevado frente a la máquina de cable.', 'Agarra las agarraderas de cuerda con un agarre prono, con las palmas una frente a la otra.', 'Mantén la espalda recta e inclínate ligeramente hacia atrás, conservando una ligera flexión en las rodillas.', 'Jala el cable hacia el cuerpo retrayendo los omóplatos y apretando los músculos de la espalda.', 'Haz una pausa por un momento en la posición de contracción completa.', 'Libera lentamente la tensión y extiende los brazos de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Upper Back']::text[]
where slug = 'cable_rope_elevated_seated_row';

-- Farmer's Walk <- "farmers walk"
update exercises set
  instructions = ARRAY['Ponte de pie con una mancuerna en cada mano, palmas hacia los costados.', 'Mantén la espalda recta y los hombros hacia atrás.', 'Da pasos pequeños y controlados hacia adelante, manteniendo una postura erguida.', 'Continúa caminando durante la distancia o el tiempo deseado.', 'Para terminar, deja de caminar y baja con cuidado las mancuernas a los costados.']::text[],
  secondary_muscles = ARRAY['Calves', 'Forearms', 'Core', 'Quads']::text[]
where slug = 'farmers_walk';

-- Front Raise (Dumbbell) <- "dumbbell front raise"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros, sosteniendo una mancuerna en cada mano con las palmas hacia los muslos.', 'Manteniendo los brazos rectos, exhala y levanta las mancuernas frente a ti hasta que queden a la altura de los hombros.', 'Haz una pausa por un momento en la parte superior, luego inhala y baja lentamente las mancuernas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Trapezius', 'Delts']::text[]
where slug = 'front_raise';

-- Front Squat (Barbell) <- "barbell front squat"
update exercises set
  instructions = ARRAY['Empieza de pie con los pies separados a la altura de los hombros, con los dedos de los pies ligeramente hacia afuera.', 'Sujeta la barra frente a los hombros, apoyándola sobre la clavícula y los hombros.', 'Activa el core y mantén el pecho elevado mientras bajas el cuerpo hacia una posición de sentadilla, empujando las caderas hacia atrás y flexionando las rodillas.', 'Baja hasta que los muslos queden paralelos al suelo, o tan abajo como puedas hacerlo cómodamente.', 'Haz una pausa por un momento en la parte inferior, luego empuja con los talones para regresar a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Quadriceps', 'Hamstrings', 'Calves', 'Core', 'Glutes']::text[]
where slug = 'front_squat';

-- Glute Bridge <- "barbell glute bridge"
update exercises set
  instructions = ARRAY['Empieza tumbado boca arriba en el suelo con las rodillas flexionadas y los pies planos sobre el suelo.', 'Coloca una barra sobre las caderas, sujetándola con firmeza con ambas manos.', 'Activa los glúteos y el core, luego levanta las caderas del suelo hasta que el cuerpo forme una línea recta desde las rodillas hasta los hombros.', 'Haz una pausa breve en la parte alta, apretando los glúteos.', 'Baja lentamente las caderas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hamstrings', 'Core', 'Lower Back', 'Glutes']::text[]
where slug = 'glute_bridge';

-- Goblet Squat (Kettlebell) <- "kettlebell goblet squat"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros, sujetando una pesa rusa cerca del pecho con ambas manos.', 'Manteniendo el pecho elevado y el core activado, baja el cuerpo a una posición de sentadilla flexionando las rodillas y las caderas.', 'Continúa bajando hasta que los muslos queden paralelos al suelo, o tan abajo como puedas hacerlo cómodamente.', 'Haz una pausa por un momento en la parte inferior, luego empuja con los talones para regresar a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Quadriceps', 'Hamstrings', 'Calves', 'Glutes']::text[]
where slug = 'goblet_squat';

-- Good Morning (Barbell) <- "barbell good morning"
update exercises set
  instructions = ARRAY['Empieza de pie con los pies separados a la altura de los hombros y la barra apoyada sobre la parte superior de la espalda.', 'Manteniendo la espalda recta y el core activado, flexiona las caderas hacia delante, empujando los glúteos hacia atrás como si intentaras tocar la pared detrás de ti con ellos.', 'Baja el torso hasta que quede paralelo al suelo, sintiendo un estiramiento en los isquiotibiales.', 'Haz una pausa breve y luego vuelve a la posición inicial apretando los glúteos y empujando las caderas hacia delante.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Lower Back', 'Hamstrings']::text[]
where slug = 'good_mornings';

-- Hammer Curl (Dumbbell) <- "dumbbell hammer curl"
update exercises set
  instructions = ARRAY['Ponte de pie con una mancuerna en cada mano, con las palmas mirando hacia el torso.', 'Mantén los codos cerca del torso y gira las palmas de las manos hasta que queden mirando hacia adelante.', 'Esta será tu posición inicial.', 'Ahora, manteniendo los brazos superiores quietos, exhala y flexiona los brazos contrayendo los bíceps.', 'Continúa levantando las pesas hasta que los bíceps estén completamente contraídos y las mancuernas estén a la altura de los hombros.', 'Mantén la posición contraída durante una breve pausa mientras aprietas los bíceps.', 'Luego, inhala y comienza a bajar lentamente las mancuernas de vuelta a la posición inicial.', 'Repite el número de repeticiones recomendado.']::text[],
  secondary_muscles = ARRAY['Forearms', 'Biceps']::text[]
where slug = 'hammer_curl';

-- Hanging Leg Raise <- "hanging leg raise"
update exercises set
  instructions = ARRAY['Cuélgate de una barra de dominadas con los brazos completamente extendidos y las palmas mirando hacia afuera.', 'Activa el core y levanta las piernas frente a ti, manteniéndolas rectas.', 'Continúa levantando hasta que las piernas estén paralelas al suelo o tan alto como puedas llegar cómodamente.', 'Haz una pausa por un momento en la parte superior, luego baja lentamente las piernas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hip Flexors', 'Abs']::text[]
where slug = 'hanging_leg_raise';

-- High Row (Machine) <- "lever high row"
update exercises set
  instructions = ARRAY['Ajusta la altura del asiento y la plataforma para los pies a una posición cómoda.', 'Siéntate en la máquina con el pecho contra la almohadilla y los pies planos sobre la plataforma para los pies.', 'Agarra las agarraderas con un agarre prono, un poco más separadas que el ancho de los hombros.', 'Mantén la espalda recta y activa el core.', 'Jala las agarraderas hacia el cuerpo, apretando los omóplatos entre sí.', 'Haz una pausa por un momento en el punto máximo del movimiento, luego suelta lentamente las agarraderas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Rear Deltoids', 'Upper Back']::text[]
where slug = 'machine_high_row';

-- Hip Adduction (Machine) <- "cable hip adduction"
update exercises set
  instructions = ARRAY['Sujeta el manguito de tobillo a tu tobillo y ponte de pie frente a la máquina de cable.', 'Colócate lo suficientemente alejado de la máquina para que haya tensión en el cable.', 'Coloca las manos sobre la máquina para apoyarte.', 'Manteniendo la pierna recta, mueve lentamente la pierna por delante del cuerpo hacia la línea media.', 'Haz una pausa por un momento al final del movimiento, luego regresa lentamente a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hamstrings', 'Glutes', 'Quadriceps', 'Adductors']::text[]
where slug = 'hip_adduction_machine';

-- Incline Bench Press (Barbell) <- "barbell incline bench press"
update exercises set
  instructions = ARRAY['Coloca un banco inclinado a un ángulo de 45 grados.', 'Túmbate en el banco con los pies planos sobre el suelo.', 'Agarra la barra con un agarre pronado un poco más ancho que la separación de los hombros.', 'Saca la barra del soporte y bájala lentamente hacia el pecho, manteniendo los codos a un ángulo de 45 grados.', 'Haz una pausa breve en la parte baja y luego empuja la barra de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Shoulders', 'Triceps', 'Pectorals']::text[]
where slug = 'incline_bench_press';

-- Incline Bench Press (Dumbbell) <- "dumbbell incline bench press"
update exercises set
  instructions = ARRAY['Coloca un banco inclinado a un ángulo de 45 grados.', 'Siéntate en el banco con los pies apoyados en el suelo y la espalda firmemente apoyada contra el banco.', 'Sostén una mancuerna en cada mano, con las palmas hacia adelante, y levántalas hasta la altura de los hombros.', 'Baja lentamente las mancuernas hacia los lados del pecho, manteniendo los codos en un ángulo de 90 grados.', 'Empuja las mancuernas de nuevo hacia arriba hasta la posición inicial, extendiendo completamente los brazos.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Shoulders', 'Triceps', 'Pectorals']::text[]
where slug = 'incline_dumbbell_press';

-- Jump Rope <- "jump rope"
update exercises set
  instructions = ARRAY['Sujeta las asas de la cuerda de saltar con las manos, palmas hacia adentro.', 'Ponte de pie con los pies separados a la altura de los hombros y las rodillas ligeramente flexionadas.', 'Balancea la cuerda por encima de la cabeza y salta sobre ella cuando se acerque a los pies.', 'Aterriza suavemente sobre la punta de los pies y repite el salto cuando la cuerda vuelva a pasar.', 'Continúa saltando durante el tiempo o el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Calves', 'Quadriceps', 'Hamstrings', 'Glutes', 'Cardiovascular System']::text[]
where slug = 'jump_rope';

-- Kettlebell Swing <- "kettlebell swing"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros, con los dedos de los pies ligeramente hacia afuera.', 'Sujeta la pesa rusa con ambas manos frente al cuerpo, con los brazos extendidos.', 'Flexiona ligeramente las rodillas e inclínate desde las caderas, empujando los glúteos hacia atrás.', 'Lleva la pesa rusa hacia atrás entre las piernas, manteniendo los brazos rectos y la espalda plana.', 'Lleva las caderas hacia adelante y haz que la pesa rusa suba hasta la altura del hombro, usando el impulso generado por las caderas.', 'Deja que la pesa rusa se balancee de vuelta hacia abajo entre las piernas y repite el movimiento el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hamstrings', 'Core', 'Glutes']::text[]
where slug = 'kettlebell_swing';

-- Lateral Raise (Cable) <- "cable lateral raise"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros y sujeta las agarraderas del cable con un agarre prono.', 'Mantén los brazos rectos y el core activado.', 'Levanta los brazos hacia los lados hasta que queden paralelos al suelo.', 'Haz una pausa por un momento en la parte superior, luego baja lentamente los brazos de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Traps', 'Triceps', 'Delts']::text[]
where slug = 'cable_lateral_raise';

-- Lateral Raise (Dumbbell) <- "dumbbell lateral raise"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros y sostén una mancuerna en cada mano, con las palmas hacia el cuerpo.', 'Mantén la espalda recta y activa el core.', 'Levanta los brazos hacia los lados hasta que queden paralelos al suelo, manteniendo una ligera flexión en los codos.', 'Haz una pausa por un momento en la parte superior, luego baja lentamente los brazos de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Traps', 'Delts']::text[]
where slug = 'lateral_raise';

-- Leg Extension (Machine) <- "lever leg extension"
update exercises set
  instructions = ARRAY['Ajusta la altura del asiento y el respaldo de la máquina a tu cuerpo.', 'Siéntate en la máquina con la espalda apoyada en el respaldo y los pies sobre la almohadilla para los pies.', 'Sujeta las asas o las barras laterales para mayor estabilidad.', 'Extiende las piernas hacia adelante enderezando las rodillas, levantando el peso.', 'Haz una pausa breve en lo alto, luego baja lentamente el peso de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hamstrings', 'Quads']::text[]
where slug = 'leg_extension';

-- Leg Press (Machine) <- "smith leg press"
update exercises set
  instructions = ARRAY['Ajusta el asiento y la placa para los pies de la máquina Smith a una posición cómoda.', 'Siéntate en la máquina con la espalda apoyada en el respaldo y los pies separados a la altura de los hombros sobre la placa para los pies.', 'Sujeta las asas o los lados de la máquina para mayor estabilidad.', 'Empuja la placa alejándola de ti extendiendo las piernas, manteniendo la espalda contra el respaldo.', 'Haz una pausa por un momento en la posición completamente extendida.', 'Dobla lentamente las rodillas y baja la placa de vuelta hacia ti, regresando a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Quadriceps', 'Hamstrings', 'Calves', 'Glutes']::text[]
where slug = 'leg_press';

-- Low Seated Row (Cable) <- "cable low seated row"
update exercises set
  instructions = ARRAY['Siéntate en la máquina con los pies planos sobre los apoyapiés y las rodillas ligeramente flexionadas.', 'Sujeta las agarraderas con un agarre prono, con las palmas hacia abajo.', 'Mantén la espalda recta e inclínate ligeramente hacia adelante, manteniendo una ligera flexión en los codos.', 'Jala las agarraderas hacia el cuerpo, apretando los omóplatos entre sí.', 'Haz una pausa por un momento en el punto máximo del movimiento, luego suelta lentamente las agarraderas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Upper Back']::text[]
where slug = 'cable_low_seated_row';

-- Lunge (Dumbbell) <- "dumbbell lunge"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros, sujetando una mancuerna en cada mano.', 'Da un paso adelante con el pie derecho, bajando el cuerpo hasta una posición de zancada.', 'Mantén la espalda recta y el pecho erguido mientras bajas el cuerpo.', 'Empuja con el talón derecho para regresar a la posición inicial.', 'Repite con la pierna izquierda.', 'Alterna las piernas el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Quadriceps', 'Hamstrings', 'Calves', 'Glutes']::text[]
where slug = 'dumbbell_lunge';

-- Lying Leg Curl (Machine) <- "lever lying leg curl"
update exercises set
  instructions = ARRAY['Ajusta la máquina a tu cuerpo y selecciona el peso deseado.', 'Túmbate boca abajo en la máquina con las piernas rectas y los talones contra la palanca acolchada.', 'Sujeta las asas o los lados de la máquina para mayor estabilidad.', 'Manteniendo la parte superior del cuerpo inmóvil, exhala y flexiona las piernas hacia arriba tanto como sea posible sin levantar las caderas de la almohadilla.', 'Mantén la posición contraída durante una pausa breve mientras aprietas los isquiotibiales.', 'Inhala y baja lentamente la palanca de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Calves', 'Hamstrings']::text[]
where slug = 'lying_leg_curl';

-- Mountain Climber <- "mountain climber"
update exercises set
  instructions = ARRAY['Comienza en una posición de plancha alta con las manos justo debajo de los hombros y el cuerpo en línea recta.', 'Activa el core y lleva la rodilla derecha hacia el pecho, luego cambia rápidamente y lleva la rodilla izquierda hacia el pecho.', 'Continúa alternando las piernas con un movimiento de carrera, manteniendo las caderas bajas y el core activado.', 'Mantén un ritmo constante y respira de forma regular durante todo el ejercicio.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Core', 'Shoulders', 'Triceps', 'Cardiovascular System']::text[]
where slug = 'mountain_climbers';

-- Narrow Grip Seated Row (Machine) <- "lever narrow grip seated row"
update exercises set
  instructions = ARRAY['Ajusta la altura del asiento y los apoyapiés para asegurar una postura correcta.', 'Siéntate en la máquina con los pies planos sobre los apoyapiés y las rodillas ligeramente flexionadas.', 'Sujeta las asas con un agarre estrecho, con las palmas una frente a la otra.', 'Mantén la espalda recta e inclínate ligeramente hacia adelante.', 'Tira de las asas hacia el torso, juntando los omóplatos.', 'Haz una pausa breve en la parte alta del movimiento.', 'Suelta lentamente las asas y vuelve a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Upper Back']::text[]
where slug = 'machine_narrow_grip_seated_row';

-- Overhead Triceps Extension (Cable) <- "cable overhead triceps extension (rope attachment)"
update exercises set
  instructions = ARRAY['Sujeta una cuerda a una máquina de cable en una posición alta.', 'Ponte de pie de espaldas a la máquina con los pies separados a la altura de los hombros.', 'Sujeta la cuerda con ambas manos, con las palmas una frente a la otra, y lleva las manos por encima de la cabeza.', 'Mantén la parte superior de los brazos cerca de la cabeza y los codos apuntando hacia adelante.', 'Baja lentamente la cuerda detrás de la cabeza flexionando los codos.', 'Haz una pausa breve y luego extiende los brazos de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Shoulders', 'Triceps']::text[]
where slug = 'cable_overhead_triceps_extension';

-- Preacher Curl (Barbell) <- "barbell preacher curl"
update exercises set
  instructions = ARRAY['Siéntate en un banco predicador con los brazos superiores apoyados en el cojín y el pecho contra el soporte.', 'Agarra la barra con un agarre supino, un poco más ancho que la separación de los hombros.', 'Manteniendo los brazos superiores fijos, exhala y levanta la barra hacia los hombros.', 'Haz una pausa breve en la parte alta, apretando los bíceps.', 'Inhala y baja lentamente la barra de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Forearms', 'Biceps']::text[]
where slug = 'preacher_curl';

-- Prone Incline Curl (Barbell) <- "barbell prone incline curl"
update exercises set
  instructions = ARRAY['Coloca un banco inclinado a un ángulo de 45 grados.', 'Túmbate boca abajo en el banco con el pecho y el abdomen apoyados contra él.', 'Sujeta una barra con un agarre supino, separado a la altura de los hombros.', 'Extiende completamente los brazos, dejando que la barra cuelgue hacia el suelo.', 'Manteniendo los brazos superiores fijos, exhala y levanta el peso mientras contraes los bíceps.', 'Continúa levantando la barra hasta que los bíceps estén completamente contraídos y la barra esté a la altura de los hombros.', 'Mantén la posición contraída durante una breve pausa mientras aprietas los bíceps.', 'Inhala y comienza a bajar lentamente la barra de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Forearms', 'Biceps']::text[]
where slug = 'barbell_prone_incline_curl';

-- Pull Up <- "pull-up"
update exercises set
  instructions = ARRAY['Cuélgate de una barra de dominadas con las palmas hacia afuera y los brazos completamente extendidos.', 'Activa el core y junta los omóplatos.', 'Tira de tu cuerpo hacia la barra flexionando los codos y llevando el pecho hacia la barra.', 'Haz una pausa en la parte alta del movimiento y luego baja lentamente el cuerpo de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Lats']::text[]
where slug = 'pull_ups';

-- Pullover (Dumbbell) <- "dumbbell pullover"
update exercises set
  instructions = ARRAY['Túmbate boca arriba en un banco con la cabeza en un extremo y los pies en el suelo.', 'Sujeta una mancuerna con ambas manos y extiende los brazos rectos por encima del pecho.', 'Manteniendo una ligera flexión en los codos, baja lentamente la mancuerna detrás de la cabeza hasta sentir un estiramiento en el pecho y los hombros.', 'Haz una pausa por un momento, luego levanta la mancuerna de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Latissimus Dorsi', 'Triceps', 'Pectorals']::text[]
where slug = 'pullover';

-- Push-Up <- "push-up"
update exercises set
  instructions = ARRAY['Comienza en una posición de plancha alta con las manos un poco más separadas que la anchura de los hombros y los pies juntos.', 'Activa el core y baja el cuerpo hacia el suelo flexionando los codos, manteniendo el cuerpo en línea recta.', 'Haz una pausa cuando el pecho esté justo por encima del suelo y luego empújate de vuelta a la posición inicial estirando los brazos.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Chest', 'Shoulders', 'Triceps', 'Deltoids', 'Core', 'Pectorals']::text[]
where slug = 'push_ups';

-- Reverse Curl (Barbell) <- "barbell reverse curl"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros y sujeta una barra con un agarre pronado, con las palmas hacia abajo.', 'Mantén los brazos superiores fijos y exhala mientras levantas la barra hacia arriba, contrayendo los bíceps.', 'Continúa levantando la barra hasta que los bíceps estén completamente contraídos y la barra esté a la altura de los hombros.', 'Mantén la posición contraída durante una breve pausa mientras aprietas los bíceps.', 'Inhala mientras bajas lentamente la barra de vuelta a la posición inicial, manteniendo los brazos superiores fijos.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Forearms', 'Biceps']::text[]
where slug = 'barbell_reverse_curl';

-- Reverse Grip Vertical Row (Machine) <- "lever reverse grip vertical row"
update exercises set
  instructions = ARRAY['Ajusta la altura del asiento y la posición de la placa para los pies para asegurar una alineación correcta.', 'Siéntate en la máquina con el pecho contra la almohadilla y los pies planos sobre la placa para los pies.', 'Sujeta las asas con un agarre supino, con las palmas hacia arriba.', 'Mantén la espalda recta y activa el core.', 'Tira de las asas hacia el pecho, juntando los omóplatos.', 'Haz una pausa breve en la parte alta del movimiento, luego suelta lentamente y extiende los brazos de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Upper Back']::text[]
where slug = 'machine_reverse_grip_vertical_row';

-- Reverse Preacher Curl (Barbell) <- "barbell reverse preacher curl"
update exercises set
  instructions = ARRAY['Siéntate en un banco predicador con el pecho apoyado en el cojín y los brazos extendidos rectos hacia abajo, sujetando una barra con un agarre pronado.', 'Manteniendo los brazos superiores fijos, exhala y levanta la barra hacia arriba mientras contraes los bíceps.', 'Continúa levantando la barra hasta que los bíceps estén completamente contraídos y la barra esté a la altura de los hombros.', 'Mantén la posición contraída durante una breve pausa mientras aprietas los bíceps.', 'Inhala y baja lentamente la barra de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Forearms', 'Biceps']::text[]
where slug = 'barbell_reverse_preacher_curl';

-- Reverse Wrist Curl (Barbell) <- "barbell reverse wrist curl"
update exercises set
  instructions = ARRAY['Siéntate en un banco con los pies planos sobre el suelo y sujeta una barra con un agarre pronado, con las palmas hacia abajo.', 'Apoya los antebrazos sobre los muslos, dejando que las muñecas cuelguen del borde.', 'Flexiona lentamente las muñecas hacia arriba, llevando la barra hacia el cuerpo.', 'Haz una pausa breve en la parte alta y luego baja lentamente la barra de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Brachialis', 'Forearms']::text[]
where slug = 'reverse_wrist_curl';

-- Romanian Deadlift (Barbell) <- "barbell romanian deadlift"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros y los dedos de los pies apuntando hacia delante.', 'Sujeta la barra con un agarre pronado, manos un poco más separadas que el ancho de los hombros.', 'Flexiona las caderas, manteniendo la espalda recta y las rodillas ligeramente flexionadas.', 'Baja la barra hacia el suelo, manteniéndola cerca del cuerpo.', 'Siente el estiramiento en los isquiotibiales mientras bajas la barra.', 'Cuando sientas el estiramiento en los isquiotibiales, empuja las caderas hacia delante y ponte de pie.', 'Aprieta los glúteos en la parte alta del movimiento.', 'Baja la barra de vuelta a la posición inicial y repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hamstrings', 'Lower Back', 'Glutes']::text[]
where slug = 'romanian_deadlift';

-- Russian Twist <- "russian twist"
update exercises set
  instructions = ARRAY['Siéntate en el suelo con las rodillas flexionadas y los pies apoyados en el suelo.', 'Inclínate ligeramente hacia atrás manteniendo la espalda recta y el core activado.', 'Junta las manos frente al pecho o sujeta una pesa si lo deseas.', 'Levanta los pies del suelo, equilibrándote sobre los isquiones.', 'Gira el torso hacia la derecha, llevando las manos o la pesa hacia el lado derecho del cuerpo.', 'Haz una pausa por un momento, luego gira el torso hacia la izquierda, llevando las manos o la pesa hacia el lado izquierdo del cuerpo.', 'Continúa alternando lados durante el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Obliques', 'Abs']::text[]
where slug = 'russian_twist';

-- Russian Twist (Weighted) <- "weighted russian twist"
update exercises set
  instructions = ARRAY['Siéntate en el suelo con las rodillas flexionadas y los pies apoyados en el suelo.', 'Sostén un peso o un balón medicinal con ambas manos frente al pecho.', 'Inclínate ligeramente hacia atrás, manteniendo la espalda recta y el core activado.', 'Gira lentamente el torso hacia la derecha, llevando el peso o el balón medicinal hacia el suelo a tu lado derecho.', 'Haz una pausa de un momento, luego gira el torso hacia la izquierda, llevando el peso o el balón medicinal hacia el suelo a tu lado izquierdo.', 'Continúa alternando lados durante el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Obliques', 'Lower Back', 'Abs']::text[]
where slug = 'weighted_russian_twist';

-- Seated Cable Row <- "cable seated row"
update exercises set
  instructions = ARRAY['Siéntate en la máquina de remo con cable con los pies planos sobre los apoyapiés y las rodillas ligeramente flexionadas.', 'Sujeta las agarraderas con un agarre prono, manteniendo la espalda recta y los hombros relajados.', 'Jala las agarraderas hacia el cuerpo, apretando los omóplatos entre sí.', 'Haz una pausa por un momento en el punto máximo del movimiento, luego suelta lentamente las agarraderas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Shoulders', 'Upper Back']::text[]
where slug = 'seated_cable_row';

-- Seated Cable Row (V-Grip) <- "cable seated row"
update exercises set
  instructions = ARRAY['Siéntate en la máquina de remo con cable con los pies planos sobre los apoyapiés y las rodillas ligeramente flexionadas.', 'Sujeta las agarraderas con un agarre prono, manteniendo la espalda recta y los hombros relajados.', 'Jala las agarraderas hacia el cuerpo, apretando los omóplatos entre sí.', 'Haz una pausa por un momento en el punto máximo del movimiento, luego suelta lentamente las agarraderas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Upper Back']::text[]
where slug = 'seated_cable_row_v_grip';

-- Seated Cable Row (Wide Grip) <- "cable seated row"
update exercises set
  instructions = ARRAY['Siéntate en la máquina de remo con cable con los pies planos sobre los apoyapiés y las rodillas ligeramente flexionadas.', 'Sujeta las agarraderas con un agarre prono, manteniendo la espalda recta y los hombros relajados.', 'Jala las agarraderas hacia el cuerpo, apretando los omóplatos entre sí.', 'Haz una pausa por un momento en el punto máximo del movimiento, luego suelta lentamente las agarraderas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Upper Back']::text[]
where slug = 'seated_cable_row_wide_grip';

-- Seated Calf Raise (Machine) <- "lever seated calf raise"
update exercises set
  instructions = ARRAY['Ajusta la altura del asiento de modo que las rodillas queden ligeramente flexionadas y los pies queden planos sobre la placa para los pies.', 'Coloca los dedos de los pies sobre la placa para los pies, con los talones colgando fuera del borde.', 'Sujeta las asas o los lados del asiento para mayor estabilidad.', 'Empuja con la parte delantera de los pies para elevar los talones tan alto como sea posible.', 'Haz una pausa breve en la parte alta y luego baja lentamente los talones de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Soleus', 'Ankle Stabilizers', 'Calves']::text[]
where slug = 'seated_calf_raise';

-- Seated High Row, V-Bar (Cable) <- "cable seated high row (v-bar)"
update exercises set
  instructions = ARRAY['Siéntate en la máquina de cable con los pies apoyados planos en el suelo y las rodillas ligeramente flexionadas.', 'Sujeta el accesorio en V con un agarre prono, con las palmas una frente a la otra y las manos separadas a la altura de los hombros.', 'Mantén la espalda recta e inclínate ligeramente hacia adelante desde las caderas.', 'Jala el accesorio en V hacia el torso retrayendo los omóplatos y apretando los músculos de la espalda.', 'Haz una pausa por un momento en el punto más alto de la contracción, luego libera lentamente la tensión y regresa a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Rhomboids', 'Rear Deltoids', 'Lats']::text[]
where slug = 'cable_seated_high_row_vbar';

-- Seated Leg Curl (Machine) <- "lever seated leg curl"
update exercises set
  instructions = ARRAY['Ajusta la máquina a tu cuerpo y siéntate en ella con la espalda apoyada en el respaldo.', 'Coloca la parte baja de las piernas debajo de la palanca acolchada, justo por encima de los tobillos.', 'Sujeta las asas a los lados de la máquina para mayor apoyo.', 'Manteniendo la parte superior de las piernas inmóvil, exhala y flexiona las piernas hacia arriba todo lo que puedas.', 'Mantén la posición contraída durante una pausa breve mientras aprietas los isquiotibiales.', 'Inhala y baja lentamente la palanca de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Calves', 'Hamstrings']::text[]
where slug = 'seated_leg_curl';

-- Seated Row (Machine) <- "lever seated row"
update exercises set
  instructions = ARRAY['Ajusta la altura del asiento y los apoyapiés a una posición cómoda.', 'Siéntate en la máquina con el pecho apoyado en la almohadilla y los pies sobre los apoyapiés.', 'Agarra las asas con un agarre prono, con las manos separadas a la altura de los hombros.', 'Mantén la espalda recta y el core activado.', 'Jala las agarraderas hacia el cuerpo, apretando los omóplatos entre sí.', 'Haz una pausa breve en la parte alta del movimiento.', 'Suelta lentamente las asas y vuelve a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Upper Back']::text[]
where slug = 'machine_seated_row';

-- Seated Shoulder Press (Dumbbell) <- "dumbbell seated shoulder press"
update exercises set
  instructions = ARRAY['Siéntate en un banco con una mancuerna en cada mano, apoyadas en los muslos.', 'Sube las mancuernas hasta la altura de los hombros, con las palmas hacia adelante.', 'Presiona las mancuernas hacia arriba hasta que los brazos queden completamente extendidos por encima de la cabeza.', 'Haz una pausa por un momento en la parte superior, luego baja lentamente las mancuernas de vuelta a la altura de los hombros.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Triceps', 'Upper Back', 'Delts']::text[]
where slug = 'seated_dumbbell_shoulder_press';

-- Shoulder Press (Machine) <- "lever shoulder press"
update exercises set
  instructions = ARRAY['Ajusta la altura del asiento y colócate en la máquina con la espalda apoyada en el respaldo.', 'Agarra las asas con un agarre prono y coloca las manos a la altura de los hombros.', 'Empuja las asas hacia arriba hasta que los brazos queden completamente extendidos, pero sin bloquear los codos.', 'Haz una pausa breve en lo alto, luego baja lentamente las asas de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Triceps', 'Chest', 'Delts']::text[]
where slug = 'shoulder_press_machine';

-- Shrug (Dumbbell) <- "dumbbell shrug"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros y sujeta una mancuerna en cada mano con las palmas hacia tu cuerpo.', 'Mantén los brazos rectos y deja que las mancuernas cuelguen a tus costados.', 'Eleva los hombros lo más alto posible, como si intentaras tocarte las orejas con ellos.', 'Mantén la contracción durante un segundo, luego baja lentamente los hombros de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Shoulders', 'Traps']::text[]
where slug = 'shrugs';

-- Sit Up <- "assisted sit-up"
update exercises set
  instructions = ARRAY['Siéntate en el borde de un banco o pide a alguien que te sujete los pies.', 'Túmbate sobre tu espalda con las rodillas flexionadas y los pies apoyados en el suelo.', 'Coloca las manos detrás de la cabeza con los codos apuntando hacia afuera.', 'Activando el abdomen, levanta lentamente la parte superior del cuerpo del suelo, curvándote hacia adelante hasta que tu torso forme un ángulo de 45 grados.', 'Haz una pausa por un momento en la parte superior, luego baja lentamente la parte superior del cuerpo de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hip Flexors', 'Abs']::text[]
where slug = 'sit_ups';

-- Sit Up (Weighted) <- "assisted sit-up"
update exercises set
  instructions = ARRAY['Siéntate en el borde de un banco o pide a alguien que te sujete los pies.', 'Túmbate sobre tu espalda con las rodillas flexionadas y los pies apoyados en el suelo.', 'Coloca las manos detrás de la cabeza con los codos apuntando hacia afuera.', 'Activando el abdomen, levanta lentamente la parte superior del cuerpo del suelo, curvándote hacia adelante hasta que tu torso forme un ángulo de 45 grados.', 'Haz una pausa por un momento en la parte superior, luego baja lentamente la parte superior del cuerpo de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hip Flexors', 'Lower Back', 'Abs']::text[]
where slug = 'weighted_sit_ups';

-- Squat (Barbell) <- "barbell squat (on knees)"
update exercises set
  instructions = ARRAY['Comienza arrodillado en el suelo con las rodillas separadas a la altura de las caderas y las puntas de los pies apuntando hacia adelante.', 'Coloca una barra sobre los hombros, sujetándola con agarre prono y las manos un poco más separadas que el ancho de los hombros.', 'Activa el core y mantén el pecho elevado mientras bajas lentamente el cuerpo flexionando las rodillas, manteniendo la espalda recta.', 'Continúa bajando hasta que los muslos queden paralelos al suelo, o tan abajo como puedas hacerlo cómodamente.', 'Haz una pausa por un momento en la parte inferior, luego empuja con los talones para regresar a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Quadriceps', 'Hamstrings', 'Calves', 'Core', 'Glutes', 'Quads']::text[]
where slug = 'back_squat';

-- Standing Calf Raise (Machine) <- "lever standing calf raise"
update exercises set
  instructions = ARRAY['Ajusta la máquina a tu altura y ponte de pie con los pies separados a la altura de los hombros.', 'Coloca los hombros debajo de las almohadillas y sujétate de las asas para mayor estabilidad.', 'Eleva los talones tan alto como puedas extendiendo los tobillos.', 'Haz una pausa breve en la parte alta y luego baja lentamente los talones de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Soleus', 'Ankle Stabilizers', 'Calves']::text[]
where slug = 'standing_calf_raise';

-- Step Up (Dumbbell) <- "dumbbell step-up"
update exercises set
  instructions = ARRAY['Ponte de pie frente a un banco o escalón con una mancuerna en cada mano, con las palmas hacia tu cuerpo.', 'Coloca el pie derecho sobre el banco o escalón, asegurándote de que todo el pie esté en contacto con la superficie.', 'Empuja con el talón derecho y sube el cuerpo sobre el banco o escalón, enderezando la pierna derecha.', 'Sube el pie izquierdo hasta el banco o escalón, quedando completamente erguido.', 'Baja con el pie izquierdo, seguido del pie derecho, volviendo a la posición inicial.', 'Repite el número de repeticiones deseado, luego cambia de pierna.']::text[],
  secondary_muscles = ARRAY['Quadriceps', 'Glutes', 'Hamstrings', 'Calves']::text[]
where slug = 'step_ups';

-- Stiff Leg Deadlift (Dumbbell) <- "dumbbell stiff leg deadlift"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros, sujetando una mancuerna en cada mano con un agarre prono.', 'Manteniendo la espalda recta y el core activado, inclínate desde las caderas y baja las mancuernas hacia el suelo, permitiendo una ligera flexión en las rodillas.', 'Baja las mancuernas hasta sentir un estiramiento en los isquiotibiales, luego aprieta los glúteos y empuja con los talones para volver a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Hamstrings', 'Lower Back', 'Glutes']::text[]
where slug = 'stiff_leg_deadlift';

-- T Bar Row <- "lever t bar row"
update exercises set
  instructions = ARRAY['Ajusta la altura del asiento y la posición de la placa para los pies para asegurar una alineación correcta.', 'Siéntate en la máquina con el pecho contra la almohadilla y los pies planos sobre la placa para los pies.', 'Agarra las agarraderas con un agarre prono, un poco más separadas que el ancho de los hombros.', 'Mantén la espalda recta y activa el core.', 'Tira de las asas hacia el torso, juntando los omóplatos.', 'Haz una pausa en el punto de máxima contracción y luego suelta lentamente las asas hasta la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Forearms', 'Upper Back']::text[]
where slug = 't_bar_row';

-- Thruster (Barbell) <- "barbell thruster"
update exercises set
  instructions = ARRAY['Comienza de pie con los pies separados a la altura de los hombros, sujetando una barra a la altura de los hombros con agarre prono.', 'Baja a una posición de sentadilla flexionando las rodillas y empujando las caderas hacia atrás.', 'Al llegar a la parte más baja de la sentadilla, empuja explosivamente con los talones para ponerte de pie, presionando simultáneamente la barra por encima de la cabeza.', 'Baja la barra de nuevo a la altura de los hombros mientras vuelves a bajar a la posición de sentadilla.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Quadriceps', 'Glutes', 'Hamstrings', 'Core', 'Delts']::text[]
where slug = 'thruster';

-- Triceps Dip <- "triceps dip"
update exercises set
  instructions = ARRAY['Siéntate en el borde de un banco o silla con las manos sujetando el borde, los dedos apuntando hacia adelante.', 'Desliza los glúteos fuera del banco, sosteniendo tu peso con las manos.', 'Flexiona los codos y baja el cuerpo hacia el suelo, manteniendo la espalda cerca del banco.', 'Haz una pausa por un momento en la parte inferior, luego empuja tu cuerpo de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Chest', 'Shoulders', 'Triceps']::text[]
where slug = 'triceps_dips';

-- Triceps Pushdown (Cable) <- "cable triceps pushdown (v-bar)"
update exercises set
  instructions = ARRAY['Coloca un accesorio en V en la máquina de cable en el ajuste más alto.', 'Ponte de pie frente a la máquina de cable con los pies separados a la altura de los hombros.', 'Agarra el accesorio en V con un agarre prono, con las palmas hacia abajo y las manos separadas a la altura de los hombros.', 'Mantén los codos cerca de los costados y los brazos superiores quietos durante todo el ejercicio.', 'Activa los tríceps y exhala mientras empujas el accesorio en V hacia abajo hasta que los brazos estén completamente extendidos.', 'Haz una pausa breve en la parte baja del movimiento, apretando los tríceps.', 'Inhala mientras regresas lentamente el accesorio en V a la posición inicial, manteniendo el control.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Forearms', 'Triceps']::text[]
where slug = 'triceps_pushdown';

-- Turkish Get Up (Kettlebell) <- "kettlebell turkish get up (squat style)"
update exercises set
  instructions = ARRAY['Comienza tumbado boca arriba con las piernas extendidas y la pesa rusa sostenida en la mano derecha, con el brazo completamente extendido por encima del hombro.', 'Flexiona la rodilla derecha y coloca el pie derecho plano en el suelo, manteniendo la pierna izquierda extendida.', 'Presionando con el pie derecho, levanta las caderas del suelo, llegando a una posición de puente.', 'Desliza la pierna izquierda por debajo del cuerpo, flexionando la rodilla izquierda y colocando el pie izquierdo plano en el suelo.', 'Rota el torso hacia la izquierda, llevando la mano izquierda al suelo como apoyo.', 'Presionando con el pie derecho y la mano izquierda, levanta el torso del suelo, llegando a una posición de rodillas.', 'Desde la posición de rodillas, ponte de pie, manteniendo la pesa rusa extendida por encima de la cabeza.', 'Invierte el movimiento para volver a la posición inicial.', 'Repite el ejercicio en el otro lado, comenzando con la pesa rusa en la mano izquierda.']::text[],
  secondary_muscles = ARRAY['Quadriceps', 'Hamstrings', 'Core', 'Glutes']::text[]
where slug = 'turkish_get_up';

-- Upright Row (Barbell) <- "barbell upright row"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros y sujeta una barra con agarre prono, manos un poco más separadas que el ancho de los hombros.', 'Deja que la barra cuelgue frente a los muslos, con los brazos completamente extendidos.', 'Manteniendo la espalda recta y el core activado, exhala y levanta la barra en línea recta hacia la barbilla, guiando el movimiento con los codos.', 'Haz una pausa breve en la parte más alta, luego inhala y baja lentamente la barra de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Traps', 'Biceps', 'Delts']::text[]
where slug = 'upright_row';

-- Walking Lunge (Dumbbell) <- "walking lunge"
update exercises set
  instructions = ARRAY['Ponte de pie con los pies separados a la altura de los hombros.', 'Da un paso adelante con la pierna derecha, bajando el cuerpo a una posición de zancada.', 'Mantén el torso erguido y la rodilla delantera alineada con el tobillo.', 'Empújate con el pie derecho y lleva el pie izquierdo hacia adelante, entrando en una posición de zancada con la pierna izquierda.', 'Continúa alternando las piernas y avanzando, manteniendo un ritmo controlado y constante.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Quadriceps', 'Hamstrings', 'Calves', 'Glutes']::text[]
where slug = 'walking_lunges';

-- Wrist Curl (Barbell) <- "barbell wrist curl"
update exercises set
  instructions = ARRAY['Siéntate en un banco con los pies planos en el suelo y los antebrazos apoyados sobre los muslos, sujetando una barra con agarre supino.', 'Deja que la barra ruede hacia las puntas de los dedos, manteniendo las muñecas rectas.', 'Enrolla lentamente la barra hacia los antebrazos flexionando las muñecas.', 'Haz una pausa breve en la parte alta y luego baja lentamente la barra de vuelta a la posición inicial.', 'Repite el número de repeticiones deseado.']::text[],
  secondary_muscles = ARRAY['Biceps', 'Brachialis', 'Forearms']::text[]
where slug = 'wrist_curl';

