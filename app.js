const STORAGE_KEY = "calculadora-notas-bonita-v1";

const elements = {
  overview: document.getElementById("overview"),
  subjects: document.getElementById("subjects"),
  addSubjectButton: document.getElementById("add-subject-button"),
  loadDemoButton: document.getElementById("load-demo-button"),
  exportButton: document.getElementById("export-button"),
  importButton: document.getElementById("import-button"),
  importFileInput: document.getElementById("import-file-input"),
};

let state = loadInitialState();

function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createSubject(overrides = {}) {
  return {
    id: overrides.id || uid(),
    name: overrides.name || "Asignatura nueva",
    passGrade: valueOrDefault(overrides.passGrade, "5"),
    components: Array.isArray(overrides.components) && overrides.components.length
      ? overrides.components.map((component) => createComponent(component))
      : [createComponent()],
  };
}

function createComponent(overrides = {}) {
  return {
    id: overrides.id || uid(),
    name: overrides.name || "",
    weight: valueOrDefault(overrides.weight, ""),
    grade: valueOrDefault(overrides.grade, ""),
    rule: overrides.rule || "none",
    minGrade: valueOrDefault(overrides.minGrade, ""),
  };
}

function createDemoState() {
  return {
    subjects: [
      createSubject({
        name: "Estadistica Aplicada",
        passGrade: "5",
        components: [
          createComponent({ name: "Examen final", weight: "45", grade: "", rule: "pass" }),
          createComponent({ name: "Practicas", weight: "25", grade: "7.8", rule: "none" }),
          createComponent({ name: "Trabajo", weight: "20", grade: "6.4", rule: "min", minGrade: "4" }),
          createComponent({ name: "Participacion", weight: "10", grade: "", rule: "none" }),
        ],
      }),
      createSubject({
        name: "Econometria",
        passGrade: "5",
        components: [
          createComponent({ name: "Parcial 1", weight: "30", grade: "5.5", rule: "none" }),
          createComponent({ name: "Parcial 2", weight: "30", grade: "", rule: "min", minGrade: "4" }),
          createComponent({ name: "Proyecto", weight: "40", grade: "", rule: "pass" }),
        ],
      }),
    ],
  };
}

function loadInitialState() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return createDemoState();
    }

    return normalizeState(JSON.parse(stored));
  } catch (error) {
    console.warn("No se pudo recuperar el estado guardado.", error);
    return createDemoState();
  }
}

function normalizeState(raw) {
  const subjects = Array.isArray(raw?.subjects) ? raw.subjects : [];
  return {
    subjects: subjects.length ? subjects.map((subject) => createSubject(subject)) : [],
  };
}

function saveState() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function valueOrDefault(value, fallback) {
  return value === undefined || value === null ? fallback : String(value);
}

function parseNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim().replace(",", ".");
  if (!text) {
    return null;
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function clamp(number, min, max) {
  return Math.min(Math.max(number, min), max);
}

function formatGrade(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return value.toFixed(2).replace(".", ",");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function getThreshold(component) {
  if (component.rule === "pass") {
    return 5;
  }

  if (component.rule === "min") {
    return clamp(parseNumber(component.minGrade) ?? 0, 0, 10);
  }

  return 0;
}

function solveRecommendedTargets(passGrade, earnedKnown, pendingComponents) {
  const weightedMax = earnedKnown + pendingComponents.reduce(
    (sum, component) => sum + component.weight * 10 / 100,
    0,
  );

  if (weightedMax + 1e-9 < passGrade) {
    return { possible: false, commonTarget: null, perComponent: {} };
  }

  const totalAt = (target) => earnedKnown + pendingComponents.reduce(
    (sum, component) => sum + component.weight * Math.max(component.threshold, target) / 100,
    0,
  );

  let low = 0;
  let high = 10;

  for (let step = 0; step < 48; step += 1) {
    const middle = (low + high) / 2;
    if (totalAt(middle) >= passGrade) {
      high = middle;
    } else {
      low = middle;
    }
  }

  const perComponent = {};
  pendingComponents.forEach((component) => {
    perComponent[component.id] = clamp(Math.max(component.threshold, high), 0, 10);
  });

  return {
    possible: true,
    commonTarget: high,
    perComponent,
  };
}

function computeSubject(subject) {
  const passGrade = clamp(parseNumber(subject.passGrade) ?? 5, 0, 10);
  const components = subject.components.map((component) => {
    const weight = Math.max(parseNumber(component.weight) ?? 0, 0);
    const gradeRaw = parseNumber(component.grade);
    const grade = gradeRaw === null ? null : clamp(gradeRaw, 0, 10);
    const threshold = getThreshold(component);
    return {
      ...component,
      weight,
      grade,
      weightValue: valueOrDefault(component.weight, ""),
      gradeValue: valueOrDefault(component.grade, ""),
      minGradeValue: valueOrDefault(component.minGrade, ""),
      threshold,
    };
  });

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const knownWeight = components.reduce(
    (sum, component) => sum + (component.grade === null ? 0 : component.weight),
    0,
  );
  const pendingComponents = components.filter((component) => component.grade === null && component.weight > 0);
  const earnedKnown = components.reduce(
    (sum, component) => sum + (component.grade === null ? 0 : component.weight * component.grade / 100),
    0,
  );
  const maximumFinal = earnedKnown + pendingComponents.reduce(
    (sum, component) => sum + component.weight * 10 / 100,
    0,
  );
  const remainingWeight = Math.max(totalWeight - knownWeight, 0);
  const neededAverage = remainingWeight > 0 ? (passGrade - earnedKnown) / (remainingWeight / 100) : null;
  const ruleFailures = components.filter(
    (component) => component.grade !== null && component.threshold > 0 && component.grade + 1e-9 < component.threshold,
  );
  const recommendation = solveRecommendedTargets(passGrade, earnedKnown, pendingComponents);
  const alreadySafe = pendingComponents.length > 0
    && earnedKnown >= passGrade
    && ruleFailures.length === 0
    && pendingComponents.every((component) => component.threshold <= 0);
  const pendingThresholds = pendingComponents.filter((component) => component.threshold > 0);

  let tone = "good";
  let status = "";

  if (!components.length || totalWeight === 0) {
    tone = "warn";
    status = "Anade al menos una parte con peso para empezar a calcular.";
  } else if (ruleFailures.length) {
    tone = "danger";
    const failedNames = ruleFailures.map((component) => component.name || "Parte sin nombre").join(", ");
    status = `Ahora mismo no puedes aprobar segun estas reglas porque no cumples el minimo en: ${failedNames}.`;
  } else if (pendingComponents.length === 0) {
    if (earnedKnown + 1e-9 >= passGrade) {
      tone = "good";
      status = "Con las notas actuales, esta asignatura ya estaria aprobada.";
    } else {
      tone = "danger";
      status = "No quedan partes pendientes y la nota final no llega al aprobado.";
    }
  } else if (maximumFinal + 1e-9 < passGrade) {
    tone = "danger";
    status = "Aunque saques un 10 en todo lo pendiente, con estas notas no llegas al aprobado.";
  } else if (alreadySafe) {
    tone = "good";
    status = "Aunque suspendieras lo que queda, por nota global ya tienes el aprobado asegurado.";
  } else if (recommendation.possible && recommendation.commonTarget <= 0.01 && pendingThresholds.length) {
    tone = "good";
    status = "Si cumples los minimos de las partes pendientes, el aprobado global ya lo tendrias.";
  } else if (recommendation.possible && recommendation.commonTarget <= 5) {
    tone = "good";
    status = `Vas bien: con una media de ${formatGrade(recommendation.commonTarget)} en lo pendiente llegas al aprobado.`;
  } else if (recommendation.possible && recommendation.commonTarget <= 7) {
    tone = "warn";
    status = `Necesitas apretar un poco: apunta a una media de ${formatGrade(recommendation.commonTarget)} en lo pendiente.`;
  } else if (recommendation.possible) {
    tone = "danger";
    status = `Necesitas una media alta, ${formatGrade(recommendation.commonTarget)}, en lo que queda para salvarla.`;
  } else {
    tone = "danger";
    status = "Con la configuracion actual no se puede alcanzar el aprobado.";
  }

  if (Math.abs(totalWeight - 100) > 0.01) {
    const difference = Math.abs(100 - totalWeight);
    const direction = totalWeight < 100 ? "faltan" : "sobran";
    status += ` Ojo: los pesos no suman 100%; ${direction} ${formatGrade(difference)} puntos porcentuales.`;
  }

  return {
    passGrade,
    components,
    totalWeight,
    knownWeight,
    remainingWeight,
    earnedKnown,
    maximumFinal,
    neededAverage,
    ruleFailures,
    recommendation,
    tone,
    status,
  };
}

function computeOverview(subjects) {
  const summaries = subjects.map((subject) => computeSubject(subject));
  const totalSubjects = subjects.length;
  const safeSubjects = summaries.filter((summary) => summary.tone === "good").length;
  const riskySubjects = summaries.filter((summary) => summary.tone === "danger").length;
  const totalPendingWeight = summaries.reduce((sum, summary) => sum + summary.remainingWeight, 0);

  return { totalSubjects, safeSubjects, riskySubjects, totalPendingWeight };
}

function renderOverview() {
  const overview = computeOverview(state.subjects);

  elements.overview.innerHTML = `
    <article class="overview-card">
      <span class="mini-label">Asignaturas</span>
      <strong class="overview-value">${overview.totalSubjects}</strong>
    </article>
    <article class="overview-card">
      <span class="mini-label">Ahora mismo bien encaminadas</span>
      <strong class="overview-value">${overview.safeSubjects}</strong>
    </article>
    <article class="overview-card">
      <span class="mini-label">En zona delicada</span>
      <strong class="overview-value">${overview.riskySubjects}</strong>
    </article>
    <article class="overview-card">
      <span class="mini-label">Peso pendiente total</span>
      <strong class="overview-value">${formatGrade(overview.totalPendingWeight)}%</strong>
    </article>
  `;
}

function renderEmptyState() {
  elements.subjects.innerHTML = `
    <section class="empty-state">
      <h2>Empieza por una asignatura</h2>
      <p>
        Puedes crearla desde cero o cargar una demo y adaptarla a tus criterios. La app guardara lo
        que cambies automaticamente.
      </p>
      <div class="empty-actions">
        <button class="primary-button" type="button" data-action="add-subject">Nueva asignatura</button>
        <button class="secondary-button" type="button" data-action="load-demo">Cargar demo</button>
      </div>
    </section>
  `;
}

function renderSubject(subject) {
  const summary = computeSubject(subject);
  const summaryToneClass = summary.tone === "good"
    ? "chip-good"
    : summary.tone === "warn"
      ? "chip-warn"
      : "chip-danger";

  const componentRows = summary.components.map((component) => {
    const recommendation = summary.recommendation.perComponent[component.id];
    let hint = `<span class="hint-text">Sin regla especial.</span>`;

    if (component.grade === null && component.weight <= 0) {
      hint = `<span class="hint-text">Ponle peso para que cuente.</span>`;
    } else if (component.grade === null && recommendation !== undefined) {
      if (component.threshold > 0 && Math.abs(recommendation - component.threshold) < 0.01) {
        hint = `<span class="hint-text">Objetivo minimo: <strong>${formatGrade(recommendation)}</strong>.</span>`;
      } else {
        hint = `<span class="hint-text">Si repartes el esfuerzo, aqui te conviene un <strong>${formatGrade(recommendation)}</strong>.</span>`;
      }
    } else if (component.grade === null) {
      hint = `<span class="hint-text">Pendiente de nota.</span>`;
    } else if (component.threshold > 0 && component.grade + 1e-9 < component.threshold) {
      hint = `<span class="hint-bad">No cumple la regla: necesita ${formatGrade(component.threshold)}.</span>`;
    } else if (component.threshold > 0) {
      hint = `<span class="hint-good">Regla cumplida.</span>`;
    }

    const rowClass = component.grade === null
      ? "pending-row"
      : component.threshold > 0 && component.grade + 1e-9 < component.threshold
        ? "blocked-row"
        : "";

    return `
      <tr class="${rowClass}">
        <td>
          <input type="text" value="${escapeHtml(component.name)}" placeholder="Examen, practica, trabajo..." data-kind="component" data-subject-id="${subject.id}" data-component-id="${component.id}" data-field="name">
        </td>
        <td>
          <input type="number" min="0" max="100" step="0.5" value="${escapeHtml(component.weightValue)}" placeholder="20" data-kind="component" data-subject-id="${subject.id}" data-component-id="${component.id}" data-field="weight">
        </td>
        <td>
          <input type="number" min="0" max="10" step="0.1" value="${escapeHtml(component.gradeValue)}" placeholder="Pendiente" data-kind="component" data-subject-id="${subject.id}" data-component-id="${component.id}" data-field="grade">
        </td>
        <td>
          <select data-kind="component" data-subject-id="${subject.id}" data-component-id="${component.id}" data-field="rule">
            <option value="none" ${component.rule === "none" ? "selected" : ""}>Sin minimo</option>
            <option value="pass" ${component.rule === "pass" ? "selected" : ""}>Debe aprobarse</option>
            <option value="min" ${component.rule === "min" ? "selected" : ""}>Minimo propio</option>
          </select>
        </td>
        <td>
          <input type="number" min="0" max="10" step="0.1" value="${escapeHtml(component.minGradeValue)}" placeholder="4" ${component.rule === "min" ? "" : "disabled"} data-kind="component" data-subject-id="${subject.id}" data-component-id="${component.id}" data-field="minGrade">
        </td>
        <td>${hint}</td>
        <td>
          <button class="ghost-button small-button" type="button" data-action="remove-component" data-subject-id="${subject.id}" data-component-id="${component.id}">
            Quitar
          </button>
        </td>
      </tr>
    `;
  }).join("");

  const pendingTips = summary.components
    .filter((component) => component.grade === null && summary.recommendation.perComponent[component.id] !== undefined)
    .map((component) => `
      <div class="tip-item">
        <span>${escapeHtml(component.name || "Parte pendiente")}</span>
        <strong>${formatGrade(summary.recommendation.perComponent[component.id])}</strong>
      </div>
    `)
    .join("");

  const neededAverageText = summary.remainingWeight <= 0
    ? "No queda nada pendiente"
    : !summary.recommendation.possible
      ? "Imposible con lo actual"
      : summary.recommendation.commonTarget <= 0.01
        ? "Cumplir minimos"
        : `${formatGrade(summary.recommendation.commonTarget)} aprox`;

  return `
    <section class="subject-card">
      <div class="subject-header">
        <div class="subject-title">
          <span class="field-label">Asignatura</span>
          <input type="text" value="${escapeHtml(subject.name)}" placeholder="Nombre de la asignatura" data-kind="subject" data-subject-id="${subject.id}" data-field="name">
        </div>
        <button class="danger-button" type="button" data-action="remove-subject" data-subject-id="${subject.id}">
          Eliminar asignatura
        </button>
      </div>

      <div class="subject-grid">
        <div class="field-card">
          <label class="field-label" for="pass-${subject.id}">Nota minima para aprobar</label>
          <input id="pass-${subject.id}" type="number" min="0" max="10" step="0.1" value="${escapeHtml(subject.passGrade)}" data-kind="subject" data-subject-id="${subject.id}" data-field="passGrade">
        </div>
        <div class="field-card">
          <span class="field-label">Peso total configurado</span>
          <input type="text" value="${formatGrade(summary.totalWeight)}%" disabled>
        </div>
        <div class="field-card">
          <span class="field-label">Peso ya evaluado</span>
          <input type="text" value="${formatGrade(summary.knownWeight)}%" disabled>
        </div>
      </div>

      <div class="summary-grid">
        <article class="summary-chip ${summaryToneClass}">
          <span class="mini-label">Llevas acumulado</span>
          <strong>${formatGrade(summary.earnedKnown)}</strong>
        </article>
        <article class="summary-chip">
          <span class="mini-label">Maximo final posible</span>
          <strong>${formatGrade(summary.maximumFinal)}</strong>
        </article>
        <article class="summary-chip">
          <span class="mini-label">Objetivo orientativo</span>
          <strong>${neededAverageText}</strong>
        </article>
        <article class="summary-chip">
          <span class="mini-label">Peso pendiente</span>
          <strong>${formatGrade(summary.remainingWeight)}%</strong>
        </article>
      </div>

      <div class="status-box ${summary.tone}">
        ${escapeHtml(summary.status)}
      </div>

      <div class="table-wrap">
        <table class="component-table">
          <thead>
            <tr>
              <th>Parte</th>
              <th>Peso %</th>
              <th>Nota</th>
              <th>Regla</th>
              <th>Minimo</th>
              <th>Que te conviene sacar</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>${componentRows}</tbody>
        </table>
      </div>

      <div class="button-row" style="margin-top: 14px;">
        <button class="primary-button small-button" type="button" data-action="add-component" data-subject-id="${subject.id}">
          Anadir parte
        </button>
      </div>

      <aside class="tips-card">
        <span class="table-note">Objetivos sugeridos en lo pendiente</span>
        ${pendingTips || '<span class="hint-text">Cuando dejes notas pendientes con peso, aqui veras una orientacion rapida.</span>'}
      </aside>
    </section>
  `;
}

function renderSubjects() {
  if (!state.subjects.length) {
    renderEmptyState();
    return;
  }

  elements.subjects.innerHTML = state.subjects.map((subject) => renderSubject(subject)).join("");
}

function render() {
  renderOverview();
  renderSubjects();
}

function updateField(target) {
  const subjectId = target.dataset.subjectId;
  const field = target.dataset.field;
  const kind = target.dataset.kind;

  if (!subjectId || !field || !kind) {
    return;
  }

  const subject = state.subjects.find((entry) => entry.id === subjectId);
  if (!subject) {
    return;
  }

  if (kind === "subject") {
    subject[field] = target.value;
  }

  if (kind === "component") {
    const component = subject.components.find((entry) => entry.id === target.dataset.componentId);
    if (!component) {
      return;
    }

    component[field] = target.value;
    if (field === "rule" && target.value !== "min") {
      component.minGrade = "";
    }
  }

  saveState();
  render();
}

function addSubject() {
  state.subjects.push(createSubject());
  saveState();
  render();
}

function addComponent(subjectId) {
  const subject = state.subjects.find((entry) => entry.id === subjectId);
  if (!subject) {
    return;
  }

  subject.components.push(createComponent());
  saveState();
  render();
}

function removeSubject(subjectId) {
  state.subjects = state.subjects.filter((entry) => entry.id !== subjectId);
  saveState();
  render();
}

function removeComponent(subjectId, componentId) {
  const subject = state.subjects.find((entry) => entry.id === subjectId);
  if (!subject) {
    return;
  }

  subject.components = subject.components.filter((entry) => entry.id !== componentId);
  saveState();
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "calculadora_notas_bonita.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      state = normalizeState(parsed);
      saveState();
      render();
      elements.importFileInput.value = "";
    } catch (error) {
      window.alert("No he podido leer ese JSON. Exporta uno desde la app y prueba otra vez.");
    }
  };
  reader.readAsText(file, "utf-8");
}

function loadDemo() {
  state = createDemoState();
  saveState();
  render();
}

elements.addSubjectButton.addEventListener("click", addSubject);
elements.loadDemoButton.addEventListener("click", loadDemo);
elements.exportButton.addEventListener("click", exportData);
elements.importButton.addEventListener("click", () => elements.importFileInput.click());
elements.importFileInput.addEventListener("change", importData);

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.matches("[data-kind]")) {
    updateField(target);
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const actionTarget = target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;
  const subjectId = actionTarget.dataset.subjectId;
  const componentId = actionTarget.dataset.componentId;

  if (action === "add-subject") {
    addSubject();
  }

  if (action === "load-demo") {
    loadDemo();
  }

  if (action === "add-component" && subjectId) {
    addComponent(subjectId);
  }

  if (action === "remove-subject" && subjectId) {
    removeSubject(subjectId);
  }

  if (action === "remove-component" && subjectId && componentId) {
    removeComponent(subjectId, componentId);
  }
});

render();
