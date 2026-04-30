// ═══════════════════════════════════════════════════════════════════════
// RIDES.JS - Sistema de planejamento de passeios (Integrado)
// ═══════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// STORAGE & DATA MANAGEMENT
// ─────────────────────────────────────────────────────────────────────

const RidesStorage = {
  KEY: 'tb.rides',
  
  load() {
    const data = localStorage.getItem(this.KEY);
    return data ? JSON.parse(data) : [];
  },
  
  save(rides) {
    localStorage.setItem(this.KEY, JSON.stringify(rides));
  },
  
  add(ride) {
    const rides = this.load();
    const newRide = {
      id: Date.now().toString(),
      ...ride,
      createdAt: new Date().toISOString()
    };
    rides.push(newRide);
    this.save(rides);
    return newRide;
  },
  
  update(id, updates) {
    const rides = this.load();
    const index = rides.findIndex(r => r.id === id);
    if (index !== -1) {
      rides[index] = { ...rides[index], ...updates };
      this.save(rides);
      return rides[index];
    }
    return null;
  },
  
  delete(id) {
    const rides = this.load();
    const filtered = rides.filter(r => r.id !== id);
    this.save(filtered);
  },
  
  getByMonth(year, month) {
    const rides = this.load();
    return rides.filter(ride => {
      const date = new Date(ride.date);
      return date.getFullYear() === year && date.getMonth() === month;
    });
  },
  
  getFuture() {
    const rides = this.load();
    const today = new Date().setHours(0, 0, 0, 0);
    return rides
      .filter(ride => new Date(ride.date).getTime() >= today)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }
};

// ─────────────────────────────────────────────────────────────────────
// CALENDAR CONTROLLER
// ─────────────────────────────────────────────────────────────────────

class RidesCalendar {
  constructor() {
    this.currentDate = new Date();
    this.viewMode = 'month'; // 'month' ou 'list'
    
    // Referências DOM
    this.btnViewMonth = document.getElementById('btn-view-month');
    this.btnViewList = document.getElementById('btn-view-list');
    this.btnAddRide = document.getElementById('btn-add-ride');
    this.btnPrevMonth = document.getElementById('btn-prev-month');
    this.btnNextMonth = document.getElementById('btn-next-month');
    this.monthTitle = document.getElementById('rides-month-title');
    this.monthContainer = document.getElementById('rides-month');
    this.listContainer = document.getElementById('rides-list');
    this.monthGrid = document.getElementById('rides-month-grid');
    this.listGrid = document.getElementById('rides-list-grid');
    
    this.init();
  }
  
  init() {
    this.attachEvents();
    this.renderMonthView();
  }
  
  attachEvents() {
    // Toggle de vista
    this.btnViewMonth?.addEventListener('click', () => this.switchView('month'));
    this.btnViewList?.addEventListener('click', () => this.switchView('list'));
    
    // Navegação de mês
    this.btnPrevMonth?.addEventListener('click', () => this.changeMonth(-1));
    this.btnNextMonth?.addEventListener('click', () => this.changeMonth(1));
    
    // Adicionar passeio
    this.btnAddRide?.addEventListener('click', () => this.openRideModal());
    
    // Clicks no grid
    this.monthGrid?.addEventListener('click', (e) => this.handleMonthGridClick(e));
    this.listGrid?.addEventListener('click', (e) => this.handleListGridClick(e));
  }
  
  switchView(mode) {
    this.viewMode = mode;
    
    if (mode === 'month') {
      this.btnViewMonth?.classList.add('active');
      this.btnViewList?.classList.remove('active');
      this.monthContainer?.classList.remove('hidden');
      this.listContainer?.classList.add('hidden');
      this.renderMonthView();
    } else {
      this.btnViewMonth?.classList.remove('active');
      this.btnViewList?.classList.add('active');
      this.monthContainer?.classList.add('hidden');
      this.listContainer?.classList.remove('hidden');
      this.renderListView();
    }
  }
  
  changeMonth(delta) {
    this.currentDate.setMonth(this.currentDate.getMonth() + delta);
    this.renderMonthView();
  }
  
  renderMonthView() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    
    // Atualizar título
    const monthNames = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    if (this.monthTitle) {
      this.monthTitle.textContent = `${monthNames[month]} ${year}`;
    }
    
    // Renderizar grid
    if (this.monthGrid) {
      this.monthGrid.innerHTML = this.buildMonthGrid(year, month);
    }
  }
  
  buildMonthGrid(year, month) {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const rides = RidesStorage.getByMonth(year, month);
    
    let html = '<div class="rides-calendar-grid">';
    
    // Headers dos dias da semana
    const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    weekdays.forEach(day => {
      html += `<div class="rides-weekday">${day}</div>`;
    });
    
    // Dias vazios antes do primeiro dia
    for (let i = 0; i < firstDay; i++) {
      html += '<div class="rides-day rides-day-empty"></div>';
    }
    
    // Dias do mês
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = this.formatDate(date);
      const isToday = this.isSameDay(date, today);
      const dayRides = rides.filter(r => r.date === dateStr);
      
      const classes = ['rides-day'];
      if (isToday) classes.push('rides-day-today');
      if (dayRides.length > 0) classes.push('rides-day-has-rides');
      
      html += `
        <div class="${classes.join(' ')}" data-date="${dateStr}">
          <div class="rides-day-number">${day}</div>
          ${dayRides.length > 0 ? `
            <div class="rides-day-indicators">
              ${dayRides.map(ride => `
                <span class="rides-indicator rides-indicator-${ride.difficulty}" 
                      title="${ride.destination}"></span>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }
    
    html += '</div>';
    return html;
  }
  
  renderListView() {
    const rides = RidesStorage.getFuture();
    
    if (!this.listGrid) return;
    
    if (rides.length === 0) {
      this.listGrid.innerHTML = `
        <div class="rides-empty-state">
          <i class="fa-solid fa-bicycle"></i>
          <p>Nenhum passeio planejado</p>
          <button class="btn btn-primary" onclick="ridesCalendar.openRideModal()">
            <i class="fa-solid fa-plus"></i> Adicionar Primeiro Passeio
          </button>
        </div>
      `;
      return;
    }
    
    this.listGrid.innerHTML = rides.map(ride => this.buildRideCard(ride)).join('');
  }
  
  buildRideCard(ride) {
    const date = new Date(ride.date);
    const dateFormatted = date.toLocaleDateString('pt-BR', { 
      weekday: 'long', 
      day: 'numeric',
      month: 'long', 
      year: 'numeric'
    });
    
    const difficultyLabels = {
      baixo: 'Baixa',
      medio: 'Média',
      alto: 'Alta'
    };
    
    const stars = Array(5).fill(0).map((_, i) => {
      const icon = i < ride.rating ? 'fa-solid fa-star' : 'fa-regular fa-star';
      return `<i class="${icon}"></i>`;
    }).join('');
    
    return `
      <div class="ride-card" data-ride-id="${ride.id}">
        <div class="ride-card-header">
          <div class="ride-card-date">
            <i class="fa-solid fa-calendar-day"></i>
            ${dateFormatted}
          </div>
          <div class="ride-card-actions">
            <button class="btn btn-icon btn-ghost" data-action="edit" data-ride-id="${ride.id}" title="Editar">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn btn-icon btn-ghost" data-action="delete" data-ride-id="${ride.id}" title="Excluir">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
        
        <h3 class="ride-card-destination">
          <i class="fa-solid fa-map-marker-alt"></i>
          ${ride.destination}
        </h3>
        
        <div class="ride-card-stats">
          <div class="ride-stat">
            <i class="fa-solid fa-route"></i>
            <div class="ride-stat-content">
              <span class="ride-stat-value">${ride.distance}</span>
              <span class="ride-stat-label">km</span>
            </div>
          </div>
          <div class="ride-stat">
            <i class="fa-solid fa-mountain"></i>
            <div class="ride-stat-content">
              <span class="ride-stat-value">${ride.altitude}</span>
              <span class="ride-stat-label">m</span>
            </div>
          </div>
          <div class="ride-stat">
            <i class="fa-solid fa-clock"></i>
            <div class="ride-stat-content">
              <span class="ride-stat-value">${ride.duration}</span>
              <span class="ride-stat-label">duração</span>
            </div>
          </div>
        </div>
        
        <div class="ride-card-footer">
          <span class="rides-difficulty-badge rides-difficulty-${ride.difficulty}">
            ${difficultyLabels[ride.difficulty]}
          </span>
          <div class="ride-card-rating">
            ${stars}
          </div>
        </div>
      </div>
    `;
  }
  
  handleMonthGridClick(e) {
    const dayEl = e.target.closest('.rides-day:not(.rides-day-empty)');
    if (!dayEl) return;
    
    const dateStr = dayEl.dataset.date;
    const rides = RidesStorage.load().filter(r => r.date === dateStr);
    
    if (rides.length > 0) {
      this.showDayModal(dateStr, rides);
    } else {
      this.openRideModal(null, dateStr);
    }
  }
  
  handleListGridClick(e) {
    const action = e.target.closest('[data-action]')?.dataset.action;
    const rideId = e.target.closest('[data-ride-id]')?.dataset.rideId;
    
    if (!action || !rideId) return;
    
    if (action === 'edit') {
      const ride = RidesStorage.load().find(r => r.id === rideId);
      this.openRideModal(ride);
    } else if (action === 'delete') {
      this.deleteRide(rideId);
    }
  }
  
  showDayModal(dateStr, rides) {
    const date = new Date(dateStr + 'T00:00:00');
    const dateFormatted = date.toLocaleDateString('pt-BR', { 
      weekday: 'long',
      day: 'numeric',
      month: 'long', 
      year: 'numeric'
    });
    
    const modalHTML = `
      <div class="modal-overlay" id="dayRidesModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3 class="modal-title">Passeios em ${dateFormatted}</h3>
            <button class="btn btn-icon btn-ghost" onclick="closeModal('dayRidesModal')">
              <i class="fa-solid fa-times"></i>
            </button>
          </div>
          
          <div class="modal-body">
            <div class="day-rides-list">
              ${rides.map(ride => `
                <div class="day-ride-item">
                  <h4>${ride.destination}</h4>
                  <div class="day-ride-stats">
                    <span><i class="fa-solid fa-route"></i> ${ride.distance} km</span>
                    <span><i class="fa-solid fa-mountain"></i> ${ride.altitude} m</span>
                    <span><i class="fa-solid fa-clock"></i> ${ride.duration}</span>
                  </div>
                  <div class="day-ride-actions">
                    <button class="btn btn-sm btn-primary" onclick="ridesCalendar.editRideFromDay('${ride.id}')">
                      <i class="fa-solid fa-pen"></i> Editar
                    </button>
                    <button class="btn btn-sm btn-ghost" onclick="ridesCalendar.deleteRideFromDay('${ride.id}')">
                      <i class="fa-solid fa-trash"></i> Excluir
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn btn-primary" onclick="ridesCalendar.openRideModal(null, '${dateStr}'); closeModal('dayRidesModal');">
              <i class="fa-solid fa-plus"></i> Adicionar Outro Passeio
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    requestAnimationFrame(() => {
      document.getElementById('dayRidesModal')?.classList.add('active');
    });
  }
  
  openRideModal(ride = null, presetDate = null) {
    const isEdit = !!ride;
    const today = new Date().toISOString().split('T')[0];
    const defaultDate = presetDate || ride?.date || today;
    
    const modalHTML = `
      <div class="modal-overlay" id="rideFormModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3 class="modal-title">${isEdit ? 'Editar Passeio' : 'Novo Passeio'}</h3>
            <button class="btn btn-icon btn-ghost" onclick="closeModal('rideFormModal')">
              <i class="fa-solid fa-times"></i>
            </button>
          </div>
          
          <form id="rideForm" class="modal-body">
            <div class="form-group">
              <label for="rideDestination">
                <i class="fa-solid fa-map-marker-alt"></i>
                Destino
              </label>
              <input 
                type="text" 
                id="rideDestination" 
                class="form-input"
                required 
                value="${ride?.destination || ''}"
                placeholder="Ex: Serra da Mantiqueira"
              />
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label for="rideDate">
                  <i class="fa-solid fa-calendar"></i>
                  Data
                </label>
                <input 
                  type="date" 
                  id="rideDate" 
                  class="form-input"
                  required 
                  value="${defaultDate}"
                  min="${today}"
                />
              </div>
              
              <div class="form-group">
                <label for="rideDuration">
                  <i class="fa-solid fa-clock"></i>
                  Tempo de Pedal
                </label>
                <input 
                  type="text" 
                  id="rideDuration" 
                  class="form-input"
                  required 
                  value="${ride?.duration || ''}"
                  placeholder="Ex: 2h 30min"
                />
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label for="rideDistance">
                  <i class="fa-solid fa-route"></i>
                  Distância (km)
                </label>
                <input 
                  type="number" 
                  id="rideDistance" 
                  class="form-input"
                  required 
                  step="0.1"
                  value="${ride?.distance || ''}"
                  placeholder="0.0"
                />
              </div>
              
              <div class="form-group">
                <label for="rideAltitude">
                  <i class="fa-solid fa-mountain"></i>
                  Altitude (m)
                </label>
                <input 
                  type="number" 
                  id="rideAltitude" 
                  class="form-input"
                  required 
                  value="${ride?.altitude || ''}"
                  placeholder="0"
                />
              </div>
            </div>
            
            <div class="form-row">
              <div class="form-group">
                <label for="rideDifficulty">
                  <i class="fa-solid fa-signal"></i>
                  Nível de Dificuldade
                </label>
                <select id="rideDifficulty" class="form-input" required>
                  <option value="baixo" ${ride?.difficulty === 'baixo' ? 'selected' : ''}>Baixa</option>
                  <option value="medio" ${ride?.difficulty === 'medio' ? 'selected' : ''}>Média</option>
                  <option value="alto" ${ride?.difficulty === 'alto' ? 'selected' : ''}>Alta</option>
                </select>
              </div>
              
              <div class="form-group">
                <label>
                  <i class="fa-solid fa-star"></i>
                  Nota do Passeio
                </label>
                <div class="rides-rating-input" id="rideRatingInput">
                  ${Array(5).fill(0).map((_, i) => `
                    <button 
                      type="button" 
                      class="rides-rating-star ${ride?.rating > i ? 'active' : ''}" 
                      data-value="${i + 1}"
                    >
                      <i class="fa-solid fa-star"></i>
                    </button>
                  `).join('')}
                </div>
                <input type="hidden" id="rideRating" value="${ride?.rating || 0}" required />
              </div>
            </div>
          </form>
          
          <div class="modal-footer">
            <button type="button" class="btn btn-ghost" onclick="closeModal('rideFormModal')">
              Cancelar
            </button>
            <button type="submit" class="btn btn-primary" form="rideForm">
              <i class="fa-solid fa-check"></i>
              ${isEdit ? 'Atualizar' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Ativar modal
    requestAnimationFrame(() => {
      document.getElementById('rideFormModal')?.classList.add('active');
    });
    
    // Eventos do formulário
    const form = document.getElementById('rideForm');
    const ratingInput = document.getElementById('rideRatingInput');
    const ratingValue = document.getElementById('rideRating');
    
    // Rating stars
    ratingInput?.addEventListener('click', (e) => {
      const star = e.target.closest('.rides-rating-star');
      if (!star) return;
      
      const value = parseInt(star.dataset.value);
      ratingValue.value = value;
      
      ratingInput.querySelectorAll('.rides-rating-star').forEach((s, i) => {
        s.classList.toggle('active', i < value);
      });
    });
    
    // Submit
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveRide(ride?.id);
    });
    
    // Focus
    setTimeout(() => document.getElementById('rideDestination')?.focus(), 100);
  }
  
  saveRide(editingId = null) {
    const formData = {
      destination: document.getElementById('rideDestination').value,
      date: document.getElementById('rideDate').value,
      duration: document.getElementById('rideDuration').value,
      distance: parseFloat(document.getElementById('rideDistance').value),
      altitude: parseInt(document.getElementById('rideAltitude').value),
      difficulty: document.getElementById('rideDifficulty').value,
      rating: parseInt(document.getElementById('rideRating').value)
    };
    
    if (editingId) {
      RidesStorage.update(editingId, formData);
    } else {
      RidesStorage.add(formData);
    }
    
    closeModal('rideFormModal');
    this.refresh();
  }
  
  editRideFromDay(id) {
    closeModal('dayRidesModal');
    const ride = RidesStorage.load().find(r => r.id === id);
    setTimeout(() => this.openRideModal(ride), 100);
  }
  
  deleteRideFromDay(id) {
    if (confirm('Deseja realmente excluir este passeio?')) {
      RidesStorage.delete(id);
      closeModal('dayRidesModal');
      this.refresh();
    }
  }
  
  deleteRide(id) {
    if (confirm('Deseja realmente excluir este passeio?')) {
      RidesStorage.delete(id);
      this.refresh();
    }
  }
  
  refresh() {
    if (this.viewMode === 'month') {
      this.renderMonthView();
    } else {
      this.renderListView();
    }
  }
  
  // Utility methods
  formatDate(date) {
    return date.toISOString().split('T')[0];
  }
  
  isSameDay(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  }
}

// ─────────────────────────────────────────────────────────────────────
// MODAL UTILITIES
// ─────────────────────────────────────────────────────────────────────

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  
  modal.classList.remove('active');
  setTimeout(() => modal.remove(), 300);
}

// ─────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────

let ridesCalendar;

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('rides')) {
    ridesCalendar = new RidesCalendar();
  }
});