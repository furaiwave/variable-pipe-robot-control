/**
 * Ukrainian names for the built-in data served by the Rust engine (default
 * configuration and experiment presets). The engine keeps English data; the
 * client localises known names when it loads them. Unknown (user-entered)
 * names are left unchanged.
 */
import { bindingLabel } from '@/lib/violations'
import type { ExperimentPreset, SimulationConfig } from '@/types/api'

const NAMES: Record<string, string> = {
  // configurations
  'Default demonstration': 'Демонстраційний сценарій',
  'Illustrative 4WD inspection robot': 'Ілюстративний інспекційний робот 4WD',
  'A – Constant-diameter pipeline': 'A – Трубопровід сталого діаметра',
  'B – Sudden diameter reduction 250 → 230 mm': 'B – Раптове звуження 250 → 230 мм',
  'B2 – Sudden diameter reduction 250 → 200 mm': 'B2 – Раптове звуження 250 → 200 мм',
  'C – Gradual transition 250 → 190 mm': 'C – Плавний перехід 250 → 190 мм',
  'D – Curved pipeline (S-bend)': 'D – Криволінійний трубопровід (S-вигин)',
  'E – Narrow passage near the feasibility limit': 'E – Вузький прохід поблизу межі проходимості',
  'E2 – Narrow passage below the feasibility limit': 'E2 – Вузький прохід нижче межі проходимості',
  'F – Controller comparison': 'F – Порівняння регуляторів',
  // pipelines
  'Demonstration line DN250 → DN200': 'Демонстраційна лінія DN250 → DN200',
  'Straight DN250, 4 m': 'Прямий DN250, 4 м',
  'Sudden reduction 250→230': 'Раптове звуження 250→230',
  'Sudden reduction 250→200': 'Раптове звуження 250→200',
  'Gradual reducer 250→190': 'Плавний перехід 250→190',
  'S-bend DN220': 'S-вигин DN220',
  'Mixed line with disturbances': 'Змішана лінія зі збуреннями',
  // segment and restriction labels
  'Bend +60° R0.6': 'Вигин +60° R0.6',
  'Bend +90° R0.5': 'Вигин +90° R0.5',
  'Bend 60° R0.6': 'Вигин 60° R0.6',
  'Bend −45° R0.4': 'Вигин −45° R0.4',
  'Bend −90° R0.35': 'Вигин −90° R0.35',
  Expander: 'Розширення',
  'Expander 200→220': 'Розширення 200→220',
  'Expander 200→250': 'Розширення 200→250',
  'Inclined 10°': 'Похилий 10°',
  'Inclined run (8°)': 'Похила ділянка (8°)',
  'Inlet DN250': 'Вхід DN250',
  'Narrow passage': 'Вузький прохід',
  'Narrow run DN200': 'Вузька ділянка DN200',
  'Narrow run with weld ring': 'Вузька ділянка зі зварним швом',
  Outlet: 'Вихід',
  'Outlet DN250': 'Вихід DN250',
  'Reduced 200 mm': 'Звужена 200 мм',
  'Reduced 230 mm': 'Звужена 230 мм',
  Reducer: 'Звуження',
  'Reducer 250→190': 'Звуження 250→190',
  'Reducer 250→200': 'Звуження 250→200',
  Straight: 'Прямий',
  'Straight DN250': 'Прямий DN250',
  'Weld bead': 'Зварний шов',
}

export function localizeName(name: string): string {
  const m = /^Narrow passage D = (\d+) mm$/.exec(name)
  if (m) return `Вузький прохід D = ${m[1]} мм`
  return NAMES[name] ?? name
}

/** Localise built-in names of a configuration (does not change any numeric value). */
export function localizeConfig(c: SimulationConfig): SimulationConfig {
  return {
    ...c,
    name: localizeName(c.name),
    robot: { ...c.robot, name: localizeName(c.robot.name) },
    pipeline: {
      ...c.pipeline,
      name: localizeName(c.pipeline.name),
      segments: c.pipeline.segments.map((s) => ({
        ...s,
        label: localizeName(s.label),
        restrictions: s.restrictions.map((r) => ({ ...r, label: localizeName(r.label) })),
      })),
    },
  }
}

const PRESET_TEXT: Record<string, { title: string; objective: string; description?: string }> = {
  'a-constant-diameter': {
    title: 'Трубопровід сталого діаметра',
    objective: 'Базове стеження та усталений рух без геометричного збурення.',
    description:
      'Пряма труба 4 м, D = 250 мм. Робот стартує на 10 мм лівіше осьової лінії, вирівняний. Опорний рух: 0,15 м/с, прискорення 0,2 м/с². Без збурень і шуму.',
  },
  'b-sudden-reduction': {
    title: 'Раптове звуження діаметра',
    objective: 'Перевірка проходження різкої сходинки та реакції регулятора на неї.',
    description:
      '1,5 м при D = 250 мм, далі різке звуження до 230 мм (сходинка стінки на лінії контакту коліс ≈ 13 мм). Сходинка перевіряється критерієм подолання на основі конуса тертя для кожної осі.',
  },
  'b2-sudden-reduction-large': {
    title: 'Раптове звуження понад межу сходинки',
    objective: 'Демонстрація виявлення непрохідної сходинки та визначення її положення.',
    description:
      'Те саме, що B, але звуження до 200 мм: сходинка стінки на лінії контакту коліс (≈ 32 мм) перевищує радіус колеса. Статичний аналіз і динамічний запуск мають вказати місце збою.',
  },
  'c-gradual-transition': {
    title: 'Плавний перехід діаметра',
    objective: 'Стеження за безперервного зменшення зазору та бічного запасу.',
    description:
      'Лінійний (конічний) перехід від 250 до 190 мм на довжині 0,8 м. Стінка під колесами утворює рампу; робот нахиляється, бічний запас проходимості зменшується.',
  },
  'd-curved-pipeline': {
    title: 'Криволінійний трубопровід',
    objective: 'Стеження за траєкторією та геометрична проходимість у вигинах різного радіуса.',
    description:
      'S-вигин у трубі 220 мм: вигин +90° (R = 0,5 м), пряма ділянка, вигин −90° (R = 0,35 м). Опорна швидкість у вигинах знижується, щоб не перевищити обмеження кутової швидкості.',
  },
  'e-narrow-passage': {
    title: 'Вузький прохід поблизу межі проходимості',
    objective: 'Визначення мінімального прохідного перерізу та перевірка регуляторів трохи вище нього.',
  },
  'e2-narrow-passage-infeasible': {
    title: 'Вузький прохід нижче межі проходимості',
    objective: 'Підтвердження, що непрохідний переріз виявляється до повідомлення про успіх.',
  },
  'f-controller-comparison': {
    title: 'Порівняння регуляторів',
    objective: 'Порівняння кінематичного базового, ПІД із фіксованими коефіцієнтами та ПІД з плануванням коефіцієнтів за однакових умов.',
    description:
      'Вигини, звуження до 200 мм зі зварним швом 3 мм, розширення та підйом 10°. Збурення: +3 % радіуса правого колеса (немодельований дрейф курсу), початкове зміщення 15 мм і похибка курсу 5°, шум сенсорів σ = 1 мм / 0,5° (зерно 2024).',
  },
}

/** Descriptions of E/E2 contain limits computed by the engine; rebuild them in Ukrainian. */
function localizeComputedDescription(id: string, d: string): string {
  if (id === 'e-narrow-passage') {
    const m = /D_min = ([\d.]+) mm \(([^)]+)\), recommended minimum ([\d.]+) mm \(([^)]+)\)\. The passage is set to (\d+) mm/.exec(d)
    if (m)
      return `Межі моделі для цього робота (по центру, пряма труба): геометричний мінімум D_min = ${m[1]} мм (${bindingLabel(m[2]!)}), рекомендований мінімум ${m[3]} мм (${bindingLabel(m[4]!)}). Прохід задано ${m[5]} мм, тобто ≈ на 4 мм вище геометричної межі: від точності стеження залежить, чи пройде робот, не торкнувшись стінки.`
  }
  if (id === 'e2-narrow-passage-infeasible') {
    const m = /Passage of (\d+) mm, ≈ 4 mm below the geometric minimum of ([\d.]+) mm/.exec(d)
    if (m) return `Прохід ${m[1]} мм, ≈ на 4 мм нижче геометричного мінімуму ${m[2]} мм.`
  }
  return d
}

export function localizePreset(p: ExperimentPreset): ExperimentPreset {
  const t = PRESET_TEXT[p.id]
  return {
    ...p,
    title: t?.title ?? p.title,
    objective: t?.objective ?? p.objective,
    description: t?.description ?? localizeComputedDescription(p.id, p.description),
    config: localizeConfig(p.config),
  }
}
