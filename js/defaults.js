/* ═══════════════════════════════════════════════════════════════════════
   DEFAULT WORKOUTS — valores iniciais para os 2 modos padrão (base, build)
   Carregados na primeira execução; depois disso o usuário edita à vontade.
═══════════════════════════════════════════════════════════════════════ */

window.DEFAULT_WORKOUTS = {
  base: [
    { id: genId(), day: 'SEG', type: 'home',  title: 'Core & Pernas I',     bpm: 'Z1/Z2',     rpm: 'N/A',   time: '30 min', tag: 'FORTALECIMENTO',
      steps: ['Plancha: 3x 45s', 'Agachamento: 3x 20', 'Elevação de Quadril: 3x 15', 'Mobilidade de Quadril'],
      tip: 'Fortalecer o glúteo ajuda a tirar a tensão da lombar nas subidas longas.' },

    { id: genId(), day: 'TER', type: 'hiit',  title: 'HIIT Queima Gordura', bpm: 'Z4-Z5',     rpm: '100+',  time: '45 min', tag: 'BIKE INTENSO',
      steps: ['Aquecimento: 15 min Z2', '8× (1 min Esforço Máximo / 2 min Z1)', 'Giro solto: 10 min'],
      tip: 'RPM alto (>100) queima gordura sem fadigar tanto os músculos das pernas.' },

    { id: genId(), day: 'QUA', type: 'group', title: 'Pedal em Grupo',      bpm: 'Z2-Z3',     rpm: '85-95', time: '30 km',  tag: 'BIKE RITMO',
      steps: ['Mantenha cadência média de 90 RPM', 'Evite marchas muito pesadas', 'Use o sensor para conferir RPM nas subidas'],
      tip: 'Cadência é sua melhor amiga para não esgotar as pernas.' },

    { id: genId(), day: 'QUI', type: 'home',  title: 'Core & Pernas II',    bpm: 'Z1/Z2',     rpm: 'N/A',   time: '30 min', tag: 'FORTALECIMENTO',
      steps: ['Escalador: 3x 40s', 'Afundo: 3x 12 cada lado', 'Ponte lateral: 3x 30s cada', 'Abdominal bicicleta: 3x 20'],
      tip: 'Abdômen forte estabiliza a bike quando você faz força no guidão.' },

    { id: genId(), day: 'SEX', type: 'rest',  title: 'Descanso Ativo',      bpm: 'Z1',        rpm: '80',    time: '20 min', tag: 'RECUPERAÇÃO',
      steps: ['Giro bem leve ou apenas alongamento', 'Foco em relaxar a musculatura'],
      tip: 'Dia de preparar o corpo para o volume de sábado.' },

    { id: genId(), day: 'SAB', type: 'long',  title: 'Longão Endurance',    bpm: 'Z2 Estrito',rpm: '80-90', time: '3 h',    tag: 'BIKE VOLUME',
      steps: ['Manter batimentos na Zona 2', 'Beber 500 ml de água/hora', 'Cadência constante'],
      tip: 'A Zona 2 ensina o corpo a usar gordura como fonte de energia principal.' },

    { id: genId(), day: 'DOM', type: 'rest',  title: 'Descanso Total',      bpm: 'OFF',       rpm: 'OFF',   time: 'OFF',    tag: 'OFF',
      steps: ['Pausar treinos', 'Focar em boa alimentação e sono'],
      tip: 'O repouso é quando as fibras musculares se reconstroem mais fortes.' },
  ],

  build: [
    { id: genId(), day: 'SEG', type: 'home',  title: 'Potência em Casa',    bpm: 'Z2',        rpm: 'N/A',   time: '40 min', tag: 'FORÇA',
      steps: ['Agachamento Búlgaro: 3x 12 cada perna', 'Prancha: 3x 60s', 'Burpees: 3x 15'],
      tip: 'Treino metabólico — combina força e cardio.' },

    { id: genId(), day: 'TER', type: 'climb', title: 'Força nas Subidas',   bpm: 'Z4-Z5',     rpm: '60-70', time: '60 min', tag: 'POTÊNCIA',
      steps: ['Aquecimento: 15 min Z2', 'Simulação de subida pesada', '3× 5 min força bruta', 'Giro solto: 10 min'],
      tip: 'Cadência baixa + marcha pesada = ganho de força para dominar o peso da bike.' },

    { id: genId(), day: 'QUA', type: 'group', title: 'Pedal em Grupo',      bpm: 'Z4',        rpm: '90',    time: '35 km',  tag: 'RITMO',
      steps: ['Manter o vácuo do grupo', 'Revezar puxada na frente', 'Cadência alta nas planas'],
      tip: 'Andar em grupo melhora a resistência psicológica para esforços longos.' },

    { id: genId(), day: 'QUI', type: 'home',  title: 'Estabilidade Core',   bpm: 'Z1',        rpm: 'N/A',   time: '30 min', tag: 'CORE',
      steps: ['Prancha braços esticados: 3x 60s', 'Super-homem (lombar): 3x 15', 'Dead bug: 3x 12 cada lado'],
      tip: 'Proteção da coluna durante longas horas no selim.' },

    { id: genId(), day: 'SEX', type: 'rest',  title: 'Giro Recuperação',    bpm: 'Z1',        rpm: '95',    time: '30 min', tag: 'SOLTURA',
      steps: ['Giro solto sem carga', 'Foco em soltar as pernas'],
      tip: 'Recuperação ativa acelera a remoção de lactato.' },

    { id: genId(), day: 'SAB', type: 'long',  title: 'Passeio Livre',       bpm: 'Z2-Z3',     rpm: '85',    time: '3.5 h',  tag: 'RESISTÊNCIA',
      steps: ['Trilha técnica ou estrada', 'Praticar trocas de marcha em subida', 'Hidratação constante'],
      tip: 'Volume longo no fim de semana é o que constrói base aeróbica.' },

    { id: genId(), day: 'DOM', type: 'rest',  title: 'Descanso',            bpm: 'OFF',       rpm: 'OFF',   time: 'OFF',    tag: 'OFF',
      steps: ['Descanso completo'],
      tip: 'Zerar para começar a próxima semana forte.' },
  ],
};

function genId() {
  return 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}
window.tbGenId = genId;
