const state = {
  selectedDate: "",
  dashboard: null
};

const elements = {
  metricStrip: document.querySelector("#metric-strip"),
  queueList: document.querySelector("#queue-list"),
  appointmentsTable: document.querySelector("#appointments-table"),
  doctorCards: document.querySelector("#doctor-cards")
};

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function renderMetrics(metrics) {
  elements.metricStrip.innerHTML = `
    <div class="metric-card">
      <span class="metric-label">Appointments</span>
      <strong>${metrics.totalAppointments}</strong>
    </div>
    <div class="metric-card">
      <span class="metric-label">Queue</span>
      <strong>${metrics.activeQueue}</strong>
    </div>
    <div class="metric-card">
      <span class="metric-label">With doctor</span>
      <strong>${metrics.inConsultation}</strong>
    </div>
    <div class="metric-card">
      <span class="metric-label">Walk-ins</span>
      <strong>${metrics.walkInsToday}</strong>
    </div>
  `;
}

function queueStatusOptions(currentStatus) {
  return ["In Queue", "With Doctor", "Completed", "Cancelled", "No Show"]
    .map((status) => `<option value="${status}" ${status === currentStatus ? "selected" : ""}>${status}</option>`)
    .join("");
}

function priorityOptions(currentPriority) {
  return ["Normal", "Priority", "Urgent"]
    .map((priority) => `<option value="${priority}" ${priority === currentPriority ? "selected" : ""}>${priority}</option>`)
    .join("");
}

function renderQueue(queue) {
  if (!queue.length) {
    elements.queueList.innerHTML = `<p class="empty-state">No active queue entries yet.</p>`;
    return;
  }

  elements.queueList.innerHTML = queue
    .map(
      (entry) => `
        <article class="queue-card">
          <div class="queue-primary">
            <div>
              <p class="queue-number">${entry.queueNumber}</p>
              <h3>${entry.patientName}</h3>
              <p class="queue-meta">${entry.visitType} • ${entry.assignedDoctorName}</p>
            </div>
            <div class="pill-group">
              <span class="badge">${entry.priorityLevel}</span>
              <span class="badge muted">${entry.estimatedWaitMinutes} min wait</span>
            </div>
          </div>
          <div class="queue-controls">
            <label>
              <span>Priority</span>
              <select data-priority-id="${entry.id}">
                ${priorityOptions(entry.priorityLevel)}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select data-status-id="${entry.id}">
                ${queueStatusOptions(entry.status)}
              </select>
            </label>
          </div>
        </article>
      `
    )
    .join("");
}

function renderAppointments(appointments) {
  if (!appointments.length) {
    elements.appointmentsTable.innerHTML = `<p class="empty-state">No appointments for this date.</p>`;
    return;
  }

  elements.appointmentsTable.innerHTML = `
    <div class="table-shell">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Patient</th>
            <th>Doctor</th>
            <th>Status</th>
            <th>Reference</th>
          </tr>
        </thead>
        <tbody>
          ${appointments
            .map(
              (appointment) => `
                <tr>
                  <td>${appointment.startTime}</td>
                  <td>${appointment.patientName}</td>
                  <td>${appointment.doctorName}</td>
                  <td>${appointment.status}</td>
                  <td>${appointment.reference}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDoctors(doctors) {
  elements.doctorCards.innerHTML = doctors
    .map(
      (doctor) => `
        <article class="doctor-card">
          <p class="panel-kicker">${doctor.activeStatus ? "Active doctor" : "Unavailable"}</p>
          <h3>${doctor.fullName}</h3>
          <div class="doctor-stats">
            <div>
              <span>Appointments</span>
              <strong>${doctor.appointmentCount}</strong>
            </div>
            <div>
              <span>Queued</span>
              <strong>${doctor.inQueueCount}</strong>
            </div>
            <div>
              <span>With doctor</span>
              <strong>${doctor.withDoctorCount}</strong>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

async function loadDashboard() {
  const payload = await api(`/api/dashboard?date=${state.selectedDate}`);
  state.dashboard = payload;
  renderMetrics(payload.metrics);
  renderQueue(payload.queue);
  renderAppointments(payload.appointments);
  renderDoctors(payload.doctorSummaries);
}

async function bootstrap() {
  state.selectedDate = todayString();
  const payload = await api(`/api/bootstrap?date=${state.selectedDate}`);
  state.dashboard = payload.dashboard;
  renderMetrics(payload.dashboard.metrics);
  renderQueue(payload.dashboard.queue);
  renderAppointments(payload.dashboard.appointments);
  renderDoctors(payload.dashboard.doctorSummaries);
}

document.addEventListener("change", async (event) => {
  const prioritySelect = event.target.closest("[data-priority-id]");
  if (prioritySelect) {
    await api(`/api/queue/${prioritySelect.dataset.priorityId}/priority`, {
      method: "POST",
      body: JSON.stringify({ priorityLevel: prioritySelect.value })
    });
    await loadDashboard();
    return;
  }

  const statusSelect = event.target.closest("[data-status-id]");
  if (statusSelect) {
    await api(`/api/queue/${statusSelect.dataset.statusId}/status`, {
      method: "POST",
      body: JSON.stringify({ status: statusSelect.value })
    });
    await loadDashboard();
  }
});

bootstrap();
setInterval(loadDashboard, 15000);
