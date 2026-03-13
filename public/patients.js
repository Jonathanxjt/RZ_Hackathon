const state = {
  selectedDate: "",
  availability: [],
  selectedSlot: null
};

const elements = {
  bookingDate: document.querySelector("#booking-date"),
  bookingForm: document.querySelector("#booking-form"),
  bookingFeedback: document.querySelector("#booking-feedback"),
  walkInForm: document.querySelector("#walkin-form"),
  walkInFeedback: document.querySelector("#walkin-feedback"),
  slotGrid: document.querySelector("#slot-grid"),
  slotSummary: document.querySelector("#slot-summary"),
  searchForm: document.querySelector("#search-form"),
  searchQuery: document.querySelector("#search-query"),
  searchResults: document.querySelector("#search-results"),
  patientQueue: document.querySelector("#patient-queue")
};

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setFeedback(target, message, type = "success") {
  target.textContent = message;
  target.className = `feedback ${type}`;
}

function clearFeedback(target) {
  target.textContent = "";
  target.className = "feedback";
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

function renderSlots() {
  if (!state.availability.length) {
    elements.slotGrid.innerHTML = `<p class="empty-state">No bookable slots for this day.</p>`;
    elements.slotSummary.textContent = "No slots available.";
    return;
  }

  const availableCount = state.availability.filter((slot) => slot.isBookable).length;
  elements.slotSummary.textContent = `${availableCount} bookable slots available.`;
  elements.slotGrid.innerHTML = state.availability
    .map((slot) => {
      const isSelected = state.selectedSlot === slot.startTime;
      const disabled = !slot.isBookable;
      const classes = ["slot-pill"];
      if (isSelected) classes.push("selected");
      if (disabled) classes.push("disabled");
      return `
        <button
          type="button"
          class="${classes.join(" ")}"
          data-time="${slot.startTime}"
          ${disabled ? "disabled" : ""}
        >
          ${slot.startTime}
        </button>
      `;
    })
    .join("");
}

async function loadAvailability() {
  const payload = await api(`/api/availability?date=${state.selectedDate}`);
  state.availability = payload.availability;
  if (!state.availability.some((slot) => slot.startTime === state.selectedSlot && slot.isBookable)) {
    state.selectedSlot = null;
  }
  renderSlots();
}

function renderPatientQueue(queue) {
  const active = queue.filter((e) => e.status === "In Queue" || e.status === "With Doctor");

  if (!active.length) {
    elements.patientQueue.innerHTML = `<p class="empty-state">No patients in the queue right now.</p>`;
    return;
  }

  elements.patientQueue.innerHTML = active
    .map(
      (entry) => `
        <article class="queue-card-readonly">
          <div class="queue-primary">
            <div>
              <p class="queue-number">${entry.queueNumber}</p>
              <h3>${entry.patientName}</h3>
              <p class="queue-meta">${entry.visitType} • ${entry.assignedDoctorName}</p>
            </div>
            <div class="pill-group">
              <span class="badge">${entry.status}</span>
              <span class="badge muted">${entry.estimatedWaitMinutes} min wait</span>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

async function loadQueue() {
  const payload = await api(`/api/dashboard?date=${state.selectedDate}`);
  renderPatientQueue(payload.queue);
}

async function bootstrap() {
  state.selectedDate = todayString();
  elements.bookingDate.value = state.selectedDate;

  const payload = await api(`/api/bootstrap?date=${state.selectedDate}`);
  state.availability = payload.availability;
  renderSlots();
  renderPatientQueue(payload.dashboard.queue);
}

async function searchAppointments(event) {
  event.preventDefault();
  const query = elements.searchQuery.value.trim();

  if (!query) {
    elements.searchResults.innerHTML = `<p class="empty-state">Enter a name, phone number, or booking reference.</p>`;
    return;
  }

  const payload = await api(
    `/api/appointments/search?date=${state.selectedDate}&query=${encodeURIComponent(query)}`
  );

  if (!payload.appointments.length) {
    elements.searchResults.innerHTML = `<p class="empty-state">No same-day appointments matched.</p>`;
    return;
  }

  elements.searchResults.innerHTML = payload.appointments
    .map(
      (appointment) => `
        <article class="search-card">
          <div>
            <h3>${appointment.patientName}</h3>
            <p>${appointment.startTime} • ${appointment.reference} • ${appointment.status}</p>
          </div>
          <button class="secondary-button" type="button" data-checkin-id="${appointment.id}">
            Check in
          </button>
        </article>
      `
    )
    .join("");
}

elements.bookingDate.addEventListener("change", async () => {
  state.selectedDate = elements.bookingDate.value;
  clearFeedback(elements.bookingFeedback);
  await loadAvailability();
});

elements.slotGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-time]");
  if (!button) return;
  state.selectedSlot = button.dataset.time;
  renderSlots();
});

elements.bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback(elements.bookingFeedback);

  if (!state.selectedSlot) {
    setFeedback(elements.bookingFeedback, "Select an available time slot first.", "error");
    return;
  }

  const formData = new FormData(elements.bookingForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await api("/api/appointments", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        date: state.selectedDate,
        time: state.selectedSlot
      })
    });
    elements.bookingForm.reset();
    state.selectedSlot = null;
    setFeedback(
      elements.bookingFeedback,
      `Booked ${result.appointment.reference} for ${result.appointment.startTime}. Confirmation created instantly.`,
      "success"
    );
    await loadAvailability();
  } catch (error) {
    setFeedback(elements.bookingFeedback, error.message, "error");
  }
});

elements.walkInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFeedback(elements.walkInFeedback);
  const formData = new FormData(elements.walkInForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await api("/api/walk-ins", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    elements.walkInForm.reset();
    setFeedback(
      elements.walkInFeedback,
      `${result.queueEntry.patientName} added as ${result.queueEntry.queueNumber}. Estimated wait ${result.queueEntry.estimatedWaitMinutes} minutes.`,
      "success"
    );
    await loadQueue();
  } catch (error) {
    setFeedback(elements.walkInFeedback, error.message, "error");
  }
});

elements.searchForm.addEventListener("submit", searchAppointments);

elements.searchResults.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-checkin-id]");
  if (!button) return;

  try {
    const result = await api("/api/check-in", {
      method: "POST",
      body: JSON.stringify({ appointmentId: button.dataset.checkinId })
    });
    elements.searchResults.innerHTML = `
      <article class="search-card">
        <div>
          <h3>${result.appointment.patientName}</h3>
          <p>Checked in successfully. Queue number ${result.queueEntry.queueNumber}.</p>
        </div>
      </article>
    `;
    await loadQueue();
  } catch (error) {
    elements.searchResults.innerHTML = `<p class="empty-state">${error.message}</p>`;
  }
});

bootstrap();
setInterval(loadQueue, 15000);
