// dashboard_admin.js
// Скрипт управления админской панелью. Здесь реализовано переключение вкладок,
// загрузка списка заявок, анализ, история закрытых заявок и редактирование статуса.

let currentAdminUser = null;

async function initAdminDashboard() {
  // При открытии админской страницы проверяем роль пользователя.
  try {
    currentAdminUser = await getMe();
    if (!currentAdminUser || currentAdminUser.role !== 'admin') {
      clearToken();
      window.location.href = 'auth.html';
      return;
    }
    // Показать специализацию администратора (если указана)
    try {
      const h2 = document.querySelector('.admin-header h2');
      if (h2 && currentAdminUser.responsibleCategory) {
        const existing = h2.querySelector('.admin-category-badge');
        if (!existing) {
          const span = document.createElement('span');
          span.className = 'admin-category-badge';
          span.textContent = `Специализация: ${currentAdminUser.responsibleCategory}`;
          h2.appendChild(span);
        } else {
          existing.textContent = `Специализация: ${currentAdminUser.responsibleCategory}`;
        }
      }
    } catch (e) {
      // ignore
    }
    switchAdminTab('all');
    // no-op: super-admin toggle removed
  } catch (error) {
    const unauthorizedMessages = ['Unauthorized', 'Invalid token', 'Not Found', 'Failed to fetch'];
    if (unauthorizedMessages.some(msg => error.message.includes(msg))) {
      clearToken();
      window.location.href = 'auth.html';
      return;
    }

    console.error('Admin init error:', error);
    const panel = document.querySelector('.dashboard-panel');
    if (panel) {
      panel.insertAdjacentHTML('afterbegin', `<div class="error-banner">Ошибка загрузки панели: ${escapeHtml(error.message)}. Попробуйте позже.</div>`);
    }
  }
}

function switchAdminTab(tab) {
  // Переключение видимых секций и активной кнопки вкладок.
  const tabConfig = {
    all: 'allSection',
    analysis: 'analysisSection',
    history: 'historySection',
    overview: 'overviewSection'
  };

  Object.entries(tabConfig).forEach(([key, sectionId]) => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.classList.toggle('hidden', key !== tab);
    }
    const button = document.getElementById(`adminTab${key.charAt(0).toUpperCase() + key.slice(1)}`);
    if (button) {
      button.classList.toggle('active-tab', key === tab);
    }
  });

  if (tab === 'all') {
    loadAllRequests();
  } else if (tab === 'analysis') {
    renderAnalysis();
    // дополнительная аналитика по категориям
    try { loadCategoryAnalytics(); } catch (e) { console.error('Category analytics load failed', e); }
  } else if (tab === 'history') {
    renderHistory();
  } else if (tab === 'overview') {
    renderOverview();
  }
}

async function loadCategoryAnalytics() {
  const categories = [
    'Аппаратное обеспечение',
    'Программное обеспечение',
    'Сеть и интернет',
    'Информационная безопасность',
    'Другое'
  ];

  const avgTimeEl = document.getElementById('avgTimeByCategory');
  const avgRatingEl = document.getElementById('avgRatingByCategory');
  const activeEl = document.getElementById('activeByCategory');

  if (avgTimeEl) avgTimeEl.innerHTML = 'Загрузка...';
  if (avgRatingEl) avgRatingEl.innerHTML = 'Загрузка...';
  if (activeEl) activeEl.innerHTML = 'Загрузка...';

  try {
    const data = await apiFetch('/analytics');

    const avgClosing = data.avgClosingTimeByCategory || {};
    const avgRating = data.avgRatingByCategory || {};
    const active = data.activeRequestsByCategory || {};

    // Render avg closing time as horizontal bar chart matching status chart
    if (avgTimeEl) {
      const shortLabels = {
        'Аппаратное обеспечение': 'Аппаратное обеспечение',
        'Программное обеспечение': 'Программное обеспечение',
        'Сеть и интернет': 'Сеть и интернет',
        'Информационная безопасность': 'Информационная безопасность',
        'Другое': 'Другое'
      };

      const values = categories.map(cat => {
        const v = avgClosing[cat];
        return (v === null || typeof v === 'undefined') ? null : Math.round(v / 60000);
      });

      const numeric = values.filter(v => v !== null);
      const maxValue = numeric.length ? Math.max(...numeric) : 1;

      const itemsHtml = categories.map((cat, idx) => {
        const val = values[idx];
        const pct = (val === null) ? 0 : Math.round((val / maxValue) * 100);
        const barBg = val === null ? 'var(--border)' : 'var(--accent)';
        let display = '—';
        if (val !== null && typeof val !== 'undefined') {
          if (typeof formatDurationWords === 'function') display = formatDurationWords(val);
          else {
            const h = Math.floor(val / 60);
            const m = val % 60;
            display = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
          }
        }

        return `
          <div class="chart-item">
            <div class="chart-item-label">${escapeHtml(shortLabels[cat] || cat)}</div>
            <div class="chart-track"><div class="chart-bar" style="width:${pct}%; background:${barBg};"></div></div>
            <div class="chart-count">${escapeHtml(display)}</div>
          </div>
        `;
      }).join('');

      avgTimeEl.innerHTML = `<div class="chart" style="width: 911px;">${itemsHtml}</div>`;
    }

    // Render avg rating as cards with colored values
    if (avgRatingEl) {
      avgRatingEl.innerHTML = categories.map(cat => {
        const val = avgRating[cat];
        let display, color;
        if (val === null || typeof val === 'undefined') {
          display = 'Нет';
          color = 'var(--text-muted)';
        } else {
          const num = Number(val);
          display = `${num.toFixed(1)} / 5`;
          if (num >= 4) color = '#22c55e';
          else if (num >= 2.5) color = '#f59e0b';
          else color = '#ef4444';
        }
        return `<article class="stats-card"><span class="metric-label">${escapeHtml(cat)}</span><strong style="color:${color}">${escapeHtml(display)}</strong></article>`;
      }).join('');
    }

    // Render active counts
    if (activeEl) {
      const items = categories.map(cat => ({ key: cat, count: Number(active[cat] || 0) }));
      // include 'Без категории' only if >0
      const nullCount = Number(active['Без категории'] || 0);
      if (nullCount > 0) items.push({ key: 'Без категории', count: nullCount });

      activeEl.innerHTML = items.map(it => `<article class="stats-card"><span class="metric-label">${escapeHtml(it.key)}</span><strong>${escapeHtml(String(it.count))}</strong></article>`).join('');
    }
  } catch (err) {
    if (avgTimeEl) avgTimeEl.innerHTML = `<p class="error-text">${escapeHtml(err.message || 'Ошибка')}</p>`;
    if (avgRatingEl) avgRatingEl.innerHTML = `<p class="error-text">${escapeHtml(err.message || 'Ошибка')}</p>`;
    if (activeEl) activeEl.innerHTML = `<p class="error-text">${escapeHtml(err.message || 'Ошибка')}</p>`;
  }
}

function getAdminSearchParams() {
  // Собирает параметры поиска и фильтрации для админской таблицы заявок.
  return {
    search: document.getElementById('adminSearchInput').value.trim(),
    status: document.getElementById('adminStatusFilter').value
  };
}

let requestCache = {};
// Локальный кеш списка заявок для открытия модалки без нового запроса.

async function loadAllRequests() {
  // Запрашивает список заявок и отображает их на вкладке "Все заявки".
  const container = document.getElementById('allRequests');
  container.innerHTML = 'Загрузка...';

  try {
    const params = getAdminSearchParams();
    const isSuperAdmin = currentAdminUser && currentAdminUser.role === 'admin' && !currentAdminUser.responsibleCategory;
    const requests = await getRequests(params);
    if (requests.length === 0) {
      container.innerHTML = '<p>Заявок не найдено.</p>';
      return;
    }

    requestCache = {};
    container.innerHTML = requests.map(r => {
      requestCache[r.id] = r;
      const ageMinutes = Math.floor((Date.now() - r.createdAt) / 60000);
      const isOldNew = r.status === 'new' && ageMinutes > 10;
      const isUncategorized = isSuperAdmin && (!r.category || r.category === '');
      const highlightClass = isUncategorized ? 'alert-card' : (isOldNew ? 'alert-card' : '');
      return `
      <div class="request-card ${highlightClass}" onclick="openRequestModal(${r.id})">
          <div class="request-heading">
            <div>
          <h3>${escapeHtml(r.title)}${isUncategorized ? ` <span class="admin-category-badge" style="margin-left:8px;">Без категории</span>` : ''}</h3>
          <span class="status ${r.status}">${formatStatus(r.status)}</span>
          <span class="priority-badge ${getPriorityClass(r.priority || '')}">${escapeHtml(r.priority || '—')}</span>
            </div>
            <button class="delete-button" onclick="event.stopPropagation(); deleteRequest(${r.id})">Удалить</button>
          </div>
          <div class="request-summary">
            <p>${escapeHtml(r.description)}</p>
        <div class="small-text">ID: ${r.id} · Пользователь: ${escapeHtml(r.owner)} · Создано: ${formatTimestamp(r.createdAt)} · ${formatAgeMinutes(ageMinutes)}</div>
          </div>
        </div>
      `;
    }).join('');
    // Update uncategorized count badge for super-admin
    try {
      if (isSuperAdmin) {
        const uncCount = requests.filter(r => !r.category).length;
        const badge = document.getElementById('filterTabUncategorizedCount');
        if (badge) {
          if (uncCount > 0) {
            badge.style.display = '';
            badge.textContent = String(uncCount);
          } else {
            badge.style.display = 'none';
          }
        }
      }
    } catch (e) {}
  } catch (error) {
    container.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
  }
}

async function deleteRequest(requestId) {
  // Удаление заявки из админской панели.
  if (!confirm('Удалить эту заявку?')) {
    return;
  }

  try {
    await deleteRequestAPI(requestId);
    const historySection = document.getElementById('historySection');
    if (historySection && !historySection.classList.contains('hidden')) {
      renderHistory();
    } else {
      loadAllRequests();
    }
  } catch (error) {
    alert(error.message);
  }
}

function openRequestModal(requestId) {
  // Открывает модальное окно с детальной информацией заявки.
  const request = requestCache[requestId];
  if (!request) return;

  const modal = document.getElementById('requestModal');
  const content = modal.querySelector('.modal-content');
  const createdAtRow = `<div class="modal-row"><strong>Создано:</strong> ${formatTimestamp(request.createdAt)}</div>`;
  const closedAtRow = request.closedAt ? `<div class="modal-row"><strong>Закрыто:</strong> ${formatTimestamp(request.closedAt)}</div>` : '';
  const closedDurationRow = request.closedDuration ? `<div class="modal-row"><strong>Закрыто за:</strong> ${escapeHtml(request.closedDuration)}</div>` : '';
  const ratingRow = request.status === 'closed'
    ? request.rating
      ? `<div class="modal-row"><strong>Оценка:</strong> ${escapeHtml(request.rating)} / 5</div>`
      : `<div class="modal-row"><strong>Оценка:</strong> нет</div>`
    : '';

  // Попробуем привести solutions к массиву
  let sols = [];
  try {
    sols = Array.isArray(request.solutions) ? request.solutions : (request.solutions ? JSON.parse(request.solutions) : []);
  } catch (e) { sols = []; }
  // Подготовим HTML-поля для новой структуры
  const solsList = Array.isArray(sols) ? sols : [];
  const hasSols = solsList.length > 0;

  let categoryField = '';
  const isSuperAdmin = currentAdminUser && currentAdminUser.role === 'admin' && !currentAdminUser.responsibleCategory;
  const hasCategory = request.category && request.category !== '';
  if (isSuperAdmin && !hasCategory) {
    categoryField = `
      <div class="modal-field">
        <span class="modal-field-label">Категория</span>
        <span class="modal-field-value">
          <select id="modalCategorySelect">
            <option value="">Выберите категорию</option>
            <option value="Аппаратное обеспечение">Аппаратное обеспечение</option>
            <option value="Программное обеспечение">Программное обеспечение</option>
            <option value="Сеть и интернет">Сеть и интернет</option>
            <option value="Информационная безопасность">Информационная безопасность</option>
            <option value="Другое">Другое</option>
          </select>
        </span>
      </div>`;
  } else {
    categoryField = `
      <div class="modal-field">
        <span class="modal-field-label">Категория</span>
        <span class="modal-field-value">${escapeHtml(request.category || '—')}</span>
      </div>`;
  }

  const hasPriority = request.priority && request.priority !== '';
  let priorityField = '';
  if (isSuperAdmin && !hasCategory) {
    priorityField = `
      <div class="modal-field">
        <span class="modal-field-label">Приоритет</span>
        <span class="modal-field-value">
          <select id="modalPrioritySelect">
            <option value="">Выберите приоритет</option>
            <option value="Низкий">Низкий</option>
            <option value="Средний">Средний</option>
            <option value="Высокий">Высокий</option>
            <option value="Критический">Критический</option>
          </select>
        </span>
      </div>`;
  } else {
    priorityField = `
      <div class="modal-field">
        <span class="modal-field-label">Приоритет</span>
        <span class="modal-field-value">${escapeHtml(request.priority || '—')}</span>
      </div>`;
  }

  const statusField = `
    <div class="modal-field">
      <span class="modal-field-label">Статус</span>
      <span class="modal-field-value"><select id="modalStatusSelect" onclick="event.stopPropagation()">
        <option value="new" ${request.status === 'new' ? 'selected' : ''}>Новая</option>
        <option value="in progress" ${request.status === 'in progress' ? 'selected' : ''}>В работе</option>
        <option value="closed" ${request.status === 'closed' ? 'selected' : ''}>Закрыта</option>
      </select></span>
    </div>`;

  const createdField = `<div class="modal-field"><span class="modal-field-label">Создано</span><span class="modal-field-value">${formatTimestamp(request.createdAt)}</span></div>`;
  const closedField = request.closedAt ? `<div class="modal-field"><span class="modal-field-label">Закрыто</span><span class="modal-field-value">${formatTimestamp(request.closedAt)}</span></div>` : '';
  const closedDurationField = request.closedDuration ? `<div class="modal-field"><span class="modal-field-label">Закрыто за</span><span class="modal-field-value">${escapeHtml(request.closedDuration)}</span></div>` : '';

  let ratingField = '';
  if (request.status === 'closed') {
    ratingField = `<div class="modal-field"><span class="modal-field-label">Оценка</span><span class="modal-field-value">${request.rating ? escapeHtml(request.rating) + ' / 5' : 'нет'}</span></div>`;
  }

  const asideHtml = hasSols ? `
    <aside class="modal-aside">
      <div class="modal-aside-header">Рекомендации AI</div>
      <ol class="modal-solutions">
        ${solsList.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ol>
    </aside>` : '';

  content.innerHTML = `
    <div class="modal-layout">
      <div class="modal-main">
        <div class="modal-title-block">
          <h3 class="modal-title">${escapeHtml(request.title)}</h3>
          <div class="modal-meta">${formatStatus(request.status)} · ID: ${request.id} · Пользователь: ${escapeHtml(request.owner)}</div>
        </div>
        <p class="modal-description">${escapeHtml(request.description)}</p>

        <div class="modal-fields">
          ${categoryField}
          ${priorityField}
          ${statusField}
          ${createdField}
          ${closedField}
          ${closedDurationField}
          ${ratingField}
        </div>

        <div class="modal-actions">
          <button class="button-secondary modal-close-button" onclick="closeRequestModal()">Закрыть</button>
          <button class="button-primary" onclick="submitModalStatus(${request.id})">Сохранить</button>
          ${isSuperAdmin && !hasCategory ? `<button class="button-primary" onclick="submitModalAssign(${request.id})">Назначить и отправить</button>` : ''}
        </div>
      </div>
      ${asideHtml}
    </div>
  `;

  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
  // Сделаем внутреннюю область прокручиваемой, если контента много
  try {
    content.style.maxHeight = '90vh';
    content.style.overflowY = 'auto';
  } catch (e) {}
}

function closeRequestModal() {
  // Закрытие модального окна.
  const modal = document.getElementById('requestModal');
  modal.classList.remove('show');
  document.body.style.overflow = '';
}

function openChangeHistory() {
  // Открывает модалку с полной историей изменений.
  const modal = document.getElementById('changeHistoryModal');
  const content = document.getElementById('changeHistoryContent');
  content.innerHTML = 'Загрузка...';
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';

  getHistory()
    .then(history => {
      if (!Array.isArray(history) || history.length === 0) {
        content.innerHTML = '<p>Нет данных об изменениях.</p>';
        return;
      }

      content.innerHTML = history.map(item => `
        <div class="history-item">
          <div class="history-time">${formatTimestamp(item.changedAt)}</div>
          <p><strong>Заявка ${item.requestId}:</strong> ${escapeHtml(item.requestTitle || '—')}</p>
          <p class="history-meta">${escapeHtml(item.changedBy)} · ${item.oldStatus ? `${formatStatus(item.oldStatus)}` : '—'} → ${formatStatus(item.newStatus)}</p>
          <p>${escapeHtml(item.note || 'Комментарий отсутствует')}</p>
        </div>
      `).join('');
    })
    .catch(error => {
      content.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
    });
}

// Закрытие модального окна истории изменений.
function closeChangeHistory() {
  const modal = document.getElementById('changeHistoryModal');
  modal.classList.remove('show');
  document.body.style.overflow = '';
}

// Открытие модального окна управления аккаунтами и предварительный рендер.
async function openAccountManager() {
  const modal = document.getElementById('accountManagerModal');
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
  // Сделаем внутреннюю область прокручиваемой, если контента много
  try {
    const acctContent = document.getElementById('accountManagerContent');
    if (acctContent) {
      acctContent.style.maxHeight = '70vh';
      acctContent.style.overflowY = 'auto';
    }
  } catch (e) {}
  await renderAccountManager('add');
}

// Закрытие окна управления аккаунтами.
function closeAccountManager() {
  const modal = document.getElementById('accountManagerModal');
  modal.classList.remove('show');
  document.body.style.overflow = '';
}

// Рендер экрана управления аккаунтами с режимами добавления и удаления.
async function renderAccountManager(mode = 'add') {
  const content = document.getElementById('accountManagerContent');
  const addButton = document.getElementById('accountManagerAdd');
  const deleteButton = document.getElementById('accountManagerDelete');

  if (addButton) addButton.classList.toggle('active', mode === 'add');
  if (deleteButton) deleteButton.classList.toggle('active', mode === 'delete');

  if (mode === 'add') {
    content.innerHTML = `
      <div class="account-manager-form">
        <div class="input-group">
          <span class="input-icon" data-icon="👤"></span>
          <input id="accountUserLogin" placeholder="Логин">
        </div>
        <div class="input-group">
          <span class="input-icon" data-icon="🔒"></span>
          <input id="accountUserPassword" type="password" placeholder="Пароль">
        </div>
        <div class="input-group">
          <span class="input-icon" data-icon="⚙️"></span>
          <select id="accountUserRole" onchange="toggleAdminCategorySelect()">
            <option value="user">Пользователь</option>
            <option value="admin">Админ</option>
          </select>
        </div>
        <div class="input-group" id="accountUserCategoryRow" style="display:none;">
          <span class="input-icon" data-icon="🏷️"></span>
          <select id="accountUserCategory">
            <option value="">Супер-админ (все категории)</option>
            <option value="Аппаратное обеспечение">Аппаратное обеспечение</option>
            <option value="Программное обеспечение">Программное обеспечение</option>
            <option value="Сеть и интернет">Сеть и интернет</option>
            <option value="Информационная безопасность">Информационная безопасность</option>
            <option value="Другое">Другое</option>
          </select>
        </div>
        <button class="button-primary" onclick="createNewUser()">Создать аккаунт</button>
      </div>
    `;
    return;
  }

  content.innerHTML = '<p>Загрузка списка пользователей...</p>';
  try {
    const users = await getUsers();
    if (!Array.isArray(users) || users.length === 0) {
      content.innerHTML = '<p>Нет пользователей для удаления.</p>';
      return;
    }

    content.innerHTML = `
      <div class="account-manager-list">
        ${users.map(user => `
          <div class="account-manager-row">
            <div>
              <strong>${escapeHtml(user.username)}</strong>
              <div class="small-text">
                ${escapeHtml(user.role)} · ${formatTimestamp(user.createdAt)}
              </div>
            </div>
            <button class="button-secondary" onclick="deleteAccount(${user.id})">Удалить</button>
          </div>
        `).join('')}
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
  }
}

async function createNewUser() {
  const username = document.getElementById('accountUserLogin')?.value.trim();
  const password = document.getElementById('accountUserPassword')?.value;
  const role = document.getElementById('accountUserRole')?.value;

  if (!username || !password || !role) {
    alert('Укажите логин, пароль и роль.');
    return;
  }

  // Определяем responsibleCategory только для роли admin
  let responsibleCategory = undefined;
  if (role === 'admin') {
    const sel = document.getElementById('accountUserCategory');
    if (sel) {
      const v = sel.value;
      responsibleCategory = v === '' ? null : v;
    }
  }

  try {
    await createUserAPI({ username, password, role, responsibleCategory });
    alert('Аккаунт создан.');
    renderAccountManager('delete');
    renderOverview();
  } catch (error) {
    alert(error.message);
  }
}

function toggleAdminCategorySelect() {
  const role = document.getElementById('accountUserRole')?.value;
  const row = document.getElementById('accountUserCategoryRow');
  if (!row) return;
  if (role === 'admin') row.style.display = '';
  else row.style.display = 'none';
}

async function deleteAccount(userId) {
  if (!confirm('Удалить этот аккаунт?')) {
    return;
  }

  try {
    await deleteUserAPI(userId);
    alert('Аккаунт удалён.');
    renderAccountManager('delete');
    renderOverview();
  } catch (error) {
    alert(error.message);
  }
}

async function submitModalStatus(requestId) {
  // Сохраняет новый статус через API и закрывает модалку.
  const select = document.getElementById('modalStatusSelect');
  if (!select) return;
  const newStatus = select.value;
  await changeRequestStatus(requestId, newStatus);
  closeRequestModal();
  if (newStatus !== 'closed') {
    switchAdminTab('all');
  }
}

async function submitModalCategory(requestId) {
  const sel = document.getElementById('modalCategorySelect');
  if (!sel) return;
  const category = sel.value;
  try {
    await changeRequestCategoryAPI(requestId, category);
    closeRequestModal();
    loadAllRequests();
  } catch (error) {
    alert(error.message);
  }
}
async function submitModalAssign(requestId) {
  const catSel = document.getElementById('modalCategorySelect');
  const priSel = document.getElementById('modalPrioritySelect');
  if (!catSel || !priSel) return;
  const category = catSel.value;
  const priority = priSel.value;
  if (!category || !priority) {
    alert('Необходимо выбрать и категорию, и приоритет');
    return;
  }
  try {
    await assignRequestAPI(requestId, category, priority);
    closeRequestModal();
    loadAllRequests();
  } catch (error) {
    alert(error.message);
  }
}

async function changeRequestStatus(requestId, status) {
  // Меняет статус заявки на сервере и обновляет список.
  try {
    await changeRequestStatusAPI(requestId, status);
    loadAllRequests();
  } catch (error) {
    alert(error.message);
  }
}

async function renderAnalysis() {
  // Загружает данные анализа и заполняет числовые карточки и диаграммы.
  try {
    const overview = await getOverviewData();
    const countNew = overview.counts['new'] || 0;
    const countProgress = overview.counts['in progress'] || 0;
    const countClosed = overview.counts['closed'] || 0;
    const total = overview.totalRequests;
    const maxCount = Math.max(countNew, countProgress, countClosed, 1);

    document.getElementById('metricNewCount').innerText = countNew;
    document.getElementById('metricProgressCount').innerText = countProgress;
    document.getElementById('metricClosedCount').innerText = countClosed;
    document.getElementById('metricOverdueCount').innerText = overview.overdueNew;
    // If admin has specialization, omit average time (duplicate of category analytics)
    if (currentAdminUser && currentAdminUser.responsibleCategory) {
      document.getElementById('chartSummary').innerText = `${overview.newestRequest ? `Самая свежая заявка: ${formatTimestamp(overview.newestRequest)}` : ''}`;
    } else {
      document.getElementById('chartSummary').innerText = `Среднее время закрытия: ${formatDurationWords(overview.averageAge)}${overview.newestRequest ? ` · Самая свежая заявка: ${formatTimestamp(overview.newestRequest)}` : ''}`;
    }

    document.getElementById('chartBarNew').style.width = `${(countNew / maxCount) * 100}%`;
    document.getElementById('chartBarProgress').style.width = `${(countProgress / maxCount) * 100}%`;
    document.getElementById('chartBarClosed').style.width = `${(countClosed / maxCount) * 100}%`;
    document.getElementById('chartCountNew').innerText = countNew;
    document.getElementById('chartCountProgress').innerText = countProgress;
    document.getElementById('chartCountClosed').innerText = countClosed;

    const ratingCounts = overview.ratingCounts || {};
    const totalRatings = [1,2,3,4,5].reduce((sum, score) => sum + (ratingCounts[score] || 0), 0);
    const pie = document.getElementById('ratingPie');
    const pieTotal = document.getElementById('ratingPieTotal');
    const legend = document.getElementById('ratingLegend');
    const tooltip = document.getElementById('ratingTooltip');

    const colors = {
      1: '#ef4444',
      2: '#fb923c',
      3: '#facc15',
      4: '#86efac',
      5: '#22c55e'
    };

    if (pie) {
      if (totalRatings === 0) {
        pie.style.background = 'conic-gradient(#e5e7eb 0deg 360deg)';
      } else {
        let start = 0;
        const segments = [1,2,3,4,5].map(score => {
          const value = ratingCounts[score] || 0;
          const degrees = totalRatings > 0 ? (value / totalRatings) * 360 : 0;
          const from = start;
          const to = start + degrees;
          start = to;
          return { score, from, to, count: value };
        });
        pie.style.background = `conic-gradient(${segments.map(s => `${colors[s.score]} ${s.from}deg ${s.to}deg`).join(', ')})`;

        // Add tooltip functionality
        pie.addEventListener('mousemove', (e) => {
          const rect = pie.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI) + 90;
          const normalizedAngle = (angle + 360) % 360;

          let currentScore = null;
          for (const segment of segments) {
            if (normalizedAngle >= segment.from && normalizedAngle < segment.to) {
              currentScore = segment.score;
              break;
            }
          }

          if (currentScore && ratingCounts[currentScore] > 0) {
            tooltip.textContent = `Оценка "${currentScore}": ${ratingCounts[currentScore]}`;
            tooltip.style.left = `${e.clientX - rect.left + 10}px`;
            tooltip.style.top = `${e.clientY - rect.top - 30}px`;
            tooltip.style.opacity = '1';
          } else {
            tooltip.style.opacity = '0';
          }
        });

        pie.addEventListener('mouseout', () => {
          tooltip.style.opacity = '0';
        });
      }
    }

    if (pieTotal) {
      pieTotal.innerText = totalRatings;
    }

    if (legend) {
      legend.innerHTML = [1,2,3,4,5].map(score => {
        const count = ratingCounts[score] || 0;
        return `
          <div class="rating-legend-item">
            <div class="rating-legend-label">
              <span class="rating-dot" style="background:${colors[score]}"></span>
              Оценка ${score}
            </div>
            <div class="rating-legend-count">${count}</div>
          </div>
        `;
      }).join('');
    }
    // Fetch analytics for specialized admin adjustments and category blocks visibility
    let analytics = null;
    try {
      analytics = await apiFetch('/analytics');
    } catch (e) {
      console.warn('Failed to load analytics for admin adjustments', e);
    }

    const isSpecialized = currentAdminUser && currentAdminUser.responsibleCategory;

    const newCardLabel = document.getElementById('metricNewCount')?.closest('article')?.querySelector('.metric-label');
    const progressCardLabel = document.getElementById('metricProgressCount')?.closest('article')?.querySelector('.metric-label');
    const closedCardLabel = document.getElementById('metricClosedCount')?.closest('article')?.querySelector('.metric-label');

    const avgTimeSectionCard = document.getElementById('avgTimeByCategory')?.closest('.panel-card');
    const avgRatingSectionCard = document.getElementById('avgRatingByCategory')?.closest('.panel-card');
    const activeSectionCard = document.getElementById('activeByCategory')?.closest('.panel-card');

    if (isSpecialized) {
      // Specialized admin: change labels and values
      if (newCardLabel) newCardLabel.textContent = 'Активные заявки';
      if (progressCardLabel) progressCardLabel.textContent = 'Среднее время закрытия';
      if (closedCardLabel) closedCardLabel.textContent = 'Средняя оценка';

      // Active count for category
      const activeForCategory = analytics && typeof analytics.activeForCategory !== 'undefined' && analytics.activeForCategory !== null ? Number(analytics.activeForCategory) : 0;
      if (document.getElementById('metricNewCount')) document.getElementById('metricNewCount').innerText = String(activeForCategory);

      // Avg time for category (ms -> formatted)
      const avgTimeForCategory = analytics && typeof analytics.avgTimeForCategory !== 'undefined' ? analytics.avgTimeForCategory : null;
      if (document.getElementById('metricProgressCount')) {
        if (avgTimeForCategory === null) {
          document.getElementById('metricProgressCount').innerText = 'Нет';
        } else {
          const mins = Math.round(Number(avgTimeForCategory) / 60000);
          const formatted = typeof formatDurationWords === 'function' ? formatDurationWords(mins) : (() => { const h = Math.floor(mins/60); const m = mins%60; return h>0? `${h} ч ${m} мин` : `${m} мин`; })();
          document.getElementById('metricProgressCount').innerText = formatted;
        }
      }

      // Avg rating for category
      const avgRatingForCategory = analytics && typeof analytics.avgRatingForCategory !== 'undefined' ? analytics.avgRatingForCategory : null;
      const closedEl = document.getElementById('metricClosedCount');
      if (closedEl) {
        if (avgRatingForCategory === null) {
          closedEl.innerText = 'Нет';
          closedEl.style.color = 'var(--text-muted)';
        } else {
          const num = Number(avgRatingForCategory);
          closedEl.innerText = `${num.toFixed(1)} / 5`;
          if (num >= 4) closedEl.style.color = '#22c55e';
          else if (num >= 2.5) closedEl.style.color = '#f59e0b';
          else closedEl.style.color = '#ef4444';
        }
      }

      // Keep overdue as is

      // Hide category detail panels for specialized admin
      try { if (avgTimeSectionCard) avgTimeSectionCard.style.display = 'none'; } catch (e) {}
      try { if (avgRatingSectionCard) avgRatingSectionCard.style.display = 'none'; } catch (e) {}
      try { if (activeSectionCard) activeSectionCard.style.display = 'none'; } catch (e) {}
    } else {
      // Super-admin: restore labels and values from overview
      if (newCardLabel) newCardLabel.textContent = 'Новые заявки';
      if (progressCardLabel) progressCardLabel.textContent = 'В работе';
      if (closedCardLabel) closedCardLabel.textContent = 'Закрытые';

      document.getElementById('metricNewCount').innerText = countNew;
      document.getElementById('metricProgressCount').innerText = countProgress;
      document.getElementById('metricClosedCount').innerText = countClosed;

      // reset color for super-admin
      try { document.getElementById('metricClosedCount').style.color = ''; } catch (e) {}

      // Show category panels
      try { if (avgTimeSectionCard) avgTimeSectionCard.style.display = ''; } catch (e) {}
      try { if (avgRatingSectionCard) avgRatingSectionCard.style.display = ''; } catch (e) {}
      try { if (activeSectionCard) activeSectionCard.style.display = ''; } catch (e) {}
    }
  } catch (error) {
    document.getElementById('metricNewCount').innerText = '—';
  }
}

async function renderHistory() {
  // Загружает закрытые заявки и показывает их в виде карточек.
  const container = document.getElementById('historyList');
  container.innerHTML = 'Загрузка...';

  try {
    const closedRequests = await getClosedRequests();
    const requests = Array.isArray(closedRequests) ? closedRequests : [];
    if (requests.length === 0) {
      container.innerHTML = '<p>Нет закрытых заявок.</p>';
      return;
    }

    requestCache = {};
    container.innerHTML = requests.map(r => {
      requestCache[r.id] = r;
      return `
            <div class="request-card" onclick="openRequestModal(${r.id})">
                <div class="request-heading">
                    <div>
                        <h3>${escapeHtml(r.title)}</h3>
                        <span class="status ${r.status}">${formatStatus(r.status)}</span>
                    </div>
                    <button class="delete-button" onclick="event.stopPropagation(); deleteRequest(${r.id})">Удалить</button>
                </div>
                <div class="request-summary">
                    <p>${escapeHtml(r.description)}</p>
                    <div class="small-text">ID: ${r.id} · Пользователь: ${escapeHtml(r.owner)} · Оценка: ${r.rating || 'нет'} · Закрыта за: ${escapeHtml(r.closedDuration || '—')}</div>
                </div>
            </div>
        `;
    }).join('');
  } catch (error) {
    container.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
  }
}

async function renderOverview() {
  // Загружает обзорную статистику и таблицу пользователей.
  const userTable = document.getElementById('usersTableBody');
  const overviewInfo = document.getElementById('overviewExtra');

  try {
    const overview = await getOverviewData();
    const users = await getUsers();

    document.getElementById('overviewUsers').innerText = overview.totalUsers;
    document.getElementById('overviewRequests').innerText = overview.totalRequests;
    document.getElementById('overviewOverdue').innerText = overview.overdueNew;
    document.getElementById('overviewActive').innerText = (overview.counts['new'] || 0) + (overview.counts['in progress'] || 0);
    overviewInfo.innerText = '';

    userTable.innerHTML = users.map(user => `
          <tr>
            <td>${user.id}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${escapeHtml(user.role)}</td>
            <td>${user.role === 'admin' ? (escapeHtml(user.responsibleCategory || 'Супер-админ')) : '-'}</td>
            <td>${formatTimestamp(user.createdAt)}</td>
            <td>${user.role === 'admin' ? '-' : user.requestCount}</td>
          </tr>
        `).join('');
    } catch (error) {
    userTable.innerHTML = `<tr><td colspan="6">Ошибка загрузки пользователей</td></tr>`;
    overviewInfo.innerText = error.message;
  }
}

function formatStatus(status) {
  switch (status) {
    case 'new':
      return 'Новая';
    case 'in progress':
      return 'В работе';
    case 'closed':
      return 'Закрыта';
    case 'deleted':
      return 'Удалена';
    default:
      return status || '—';
  }
}

function getPriorityClass(priority) {
  if (!priority) return 'priority-low';
  const p = String(priority).toLowerCase();
  if (p.includes('крит') || p.includes('critical')) return 'priority-critical';
  if (p.includes('высок') || p.includes('high')) return 'priority-high';
  if (p.includes('сред') || p.includes('med')) return 'priority-medium';
  if (p.includes('низ') || p.includes('low')) return 'priority-low';
  return 'priority-low';
}

function pluralize(count, one, few, many) {
  const normalized = Math.abs(count) % 100;
  const lastDigit = normalized % 10;
  if (normalized > 10 && normalized < 20) return many;
  if (lastDigit === 1) return one;
  if (lastDigit >= 2 && lastDigit <= 4) return few;
  return many;
}

function formatDurationWords(totalMinutes) {
  const minutes = Math.max(0, Math.round(totalMinutes || 0));
  if (minutes < 60) {
    return `${minutes} ${pluralize(minutes, 'минута', 'минуты', 'минут')}`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hoursText = `${hours} ${pluralize(hours, 'час', 'часа', 'часов')}`;
  if (!remainder) {
    return hoursText;
  }
  return `${hoursText} ${remainder} ${pluralize(remainder, 'минута', 'минуты', 'минут')}`;
}

function formatAgeMinutes(minutes) {
  return `${formatDurationWords(minutes)}`;
}

function formatTimestamp(value) {
  const date = new Date(value);
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function logout() {
  clearToken();
  window.location.href = 'auth.html';
}
