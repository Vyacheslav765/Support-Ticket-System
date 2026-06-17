// dashboard_user.js
// Клиентская логика пользовательского кабинета: создание заявок, поиск,
// загрузка списка и показ модального окна с деталями заявки.

async function initUserDashboard() {
  // Проверка текущего пользователя на роль перед показом страницы.
  try {
    const currentUser = await getMe();
    if (currentUser.role !== 'user') {
      window.location.href = 'auth.html';
      return;
    }
    const greetingText = currentUser.username || currentUser.login || currentUser.email || 'пользователь';
    const greetingLabel = document.getElementById('userGreeting');
    if (greetingLabel) greetingLabel.textContent = `Здравствуйте, ${greetingText}`;
    const requestDesc = document.getElementById('requestDesc');
    if (requestDesc) {
      requestDesc.addEventListener('input', autoResizeTextarea);
      autoResizeTextarea(requestDesc);
    }
    loadUserRequests();
  } catch (error) {
    window.location.href = 'auth.html';
  }
}


async function createRequest() {
  // Создание новой заявки через API и перезагрузка списка заявок.
  const title = document.getElementById('requestTitle').value.trim();
  const description = document.getElementById('requestDesc').value.trim();

  if (!title || !description) {
    alert('Заполните заявку');
    return;
  }

  // Сначала попробуем выполнить анализ описания через AI
  const createButton = document.querySelector('.button-primary[onclick="createRequest()"]');
  const originalText = createButton ? createButton.textContent : null;
  if (createButton) {
    createButton.disabled = true;
    createButton.textContent = 'Анализ...';
  }

  try {
    // Попытки анализа с индикатором статуса рядом с кнопкой (до 3 попыток)
    let analysis = null;
    function setAIStatus(text) {
      let status = document.getElementById('aiStatus');
      if (!status) {
        status = document.createElement('span');
        status.id = 'aiStatus';
        status.style.marginLeft = '10px';
        status.style.fontSize = '0.95em';
        status.style.color = '#666';
        if (createButton && createButton.parentNode) createButton.parentNode.insertBefore(status, createButton.nextSibling);
      }
      status.textContent = text || '';
    }
    function clearAIStatus() {
      const status = document.getElementById('aiStatus');
      if (status) status.textContent = '';
    }

    const maxAttempts = 3;
    const baseDelay = 500; // ms
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        setAIStatus(`Анализ: попытка ${attempt}/${maxAttempts}...`);
        analysis = await analyzeDescriptionAPI(description);
        if (analysis) break;
      } catch (err) {
        lastErr = err;
        console.warn('AI analysis attempt', attempt, 'failed', err);
        // If API rate-limited, stop retrying immediately
        if (err && err.status === 429) {
          setAIStatus('Превышен лимит запросов к AI.');
          break;
        }
      }
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, baseDelay * attempt));
      }
    }

    if (!analysis) {
      // Если квота превышена — спросим пользователя, создавать ли заявку без анализа
      if (lastErr && lastErr.status === 429) {
        clearAIStatus();
        const proceed = confirm('Превышен лимит запросов к AI. Создать заявку без анализа?');
        if (!proceed) {
          cleanupAfterCreate();
          return;
        }
        await createRequestAPI(title, description);
        cleanupAfterCreate();
        clearAIStatus();
        return;
      }

      // Показываем пользователю рекомендацию от сервера, если есть
      const serverAdvice = lastErr && lastErr.data && (lastErr.data.systemAction || lastErr.data.details) ? (lastErr.data.systemAction || lastErr.data.details) : null;
      if (serverAdvice) {
        setAIStatus(serverAdvice);
      } else {
        setAIStatus('Рекомендации недоступны - создаём стандартную заявку.');
      }
      // Если анализ недоступен — уведомляем и создаём стандартную заявку
      alert('Рекомендации от AI недоступны — заявка будет создана в стандартном режиме.');
      await createRequestAPI(title, description);
      // Обновляем список "Мои заявки" автоматически после создания
      try {
        await loadUserRequests();
      } catch (e) {
        // не фатально, просто игнорируем ошибку загрузки
      }
      cleanupAfterCreate();
      clearAIStatus();
      return;
    }

    // Показать модальное окно с результатами анализа
    clearAIStatus();
    openAnalysisModal({ title, description, analysis }, async (action) => {
      // action === 'create' | 'solved'
      if (action === 'solved') {
        alert('Проблема помечена как решённая. Заявка не зарегистрирована.');
        cleanupAfterCreate();
        return;
      }

      // action === 'create' — создаём заявку и сохраняем данные от AI
      const payloadMeta = {
        category: analysis.category,
        priority: analysis.priority,
        solutions: analysis.solutions
      };
      await createRequestAPI(title, description, payloadMeta);
      alert('Заявка создана с рекомендациями.');
      cleanupAfterCreate();
      loadUserRequests();
    });
  } catch (error) {
    alert(error.message || 'Ошибка при создании заявки');
  } finally {
    if (createButton) {
      createButton.disabled = false;
      if (originalText) createButton.textContent = originalText;
    }
  }
}

function cleanupAfterCreate() {
  document.getElementById('requestTitle').value = '';
  const requestDesc = document.getElementById('requestDesc');
  if (requestDesc) {
    requestDesc.value = '';
    requestDesc.style.height = 'auto';
  }
  closeModal(document.getElementById('requestModal'));
  const status = document.getElementById('aiStatus');
  if (status) status.textContent = '';
}

function openAnalysisModal(ctx, callback) {
  // ctx: { title, description, analysis: { category, priority, solutions } }
  const modal = document.getElementById('requestModal');
  const content = modal.querySelector('.modal-content');
  const analysis = ctx.analysis || {};

  const solutionsHtml = (analysis.solutions || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');

  content.innerHTML = `
    <h3>Рекомендации по обращению</h3>
    <div class="modal-row"><strong>Категория:</strong> ${escapeHtml(analysis.category || '—')}</div>
    <div class="modal-row"><strong>Приоритет:</strong> ${escapeHtml(analysis.priority || '—')}</div>
    ${analysis.model ? `<div class="modal-row"><strong>Модель:</strong> ${escapeHtml(analysis.model)}</div>` : ''}
    <div class="modal-row"><strong>Рекомендованные решения:</strong>
      <ol>${solutionsHtml}</ol>
    </div>
    <div class="modal-actions">
      <button class="button-secondary" id="analysisSolvedBtn">Проблема решена</button>
      <button class="button-primary" id="analysisCreateBtn">Создать заявку</button>
    </div>
  `;

  // Добавим плавающую метку с названием модели внизу справа модального диалога
  // (model name is rendered inline inside the modal content between priority and recommendations)

  // Привязываем обработчики и блокируем прокрутку страницы под модалкой
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';

  const solvedBtn = document.getElementById('analysisSolvedBtn');
  const createBtn = document.getElementById('analysisCreateBtn');

  function cleanupHandlers() {
    if (solvedBtn) solvedBtn.onclick = null;
    if (createBtn) createBtn.onclick = null;
  }

  if (solvedBtn) solvedBtn.onclick = () => {
    cleanupHandlers();
    closeModal(modal);
    callback('solved');
  };
  if (createBtn) createBtn.onclick = () => {
    cleanupHandlers();
    closeModal(modal);
    callback('create');
  };

  // SLA prediction hint: fetch prediction based on title and render under buttons
  try {
    const actions = content.querySelector('.modal-actions');
    const hint = document.createElement('div');
    // reuse existing muted small text styles
    hint.className = 'section-note';
    hint.textContent = 'Загрузка оценки времени обработки...';
    if (actions && actions.parentNode) {
      actions.parentNode.insertBefore(hint, actions.nextSibling);
    } else if (content) {
      content.appendChild(hint);
    }

    (async () => {
      try {
        const resp = await getSLAPredict(ctx.title || '');
        if (!resp || typeof resp.median === 'undefined' || resp.median === null) {
          // nothing to show
          hint.textContent = '';
          return;
        }

        const medianMs = Number(resp.median);
        const medianText = formatDurationWords(Math.max(0, Math.round(medianMs / 60000)));
        const countText = resp.isFallback ? 'общая оценка' : `${resp.count} похожих заявок`;

        hint.innerHTML = `Обычно такие заявки закрываются за <strong>${escapeHtml(medianText)}</strong>. <span class="small-text">(${escapeHtml(countText)})</span>`;
      } catch (e) {
        hint.textContent = '';
      }
    })();
  } catch (e) {
    // ignore
  }
}

async function deleteRequest(requestId) {
  // Удаление заявки с подтверждением.
  if (!confirm('Удалить эту заявку?')) {
    return;
  }

  try {
    await deleteRequestAPI(requestId);
    loadUserRequests();
  } catch (error) {
    alert(error.message);
  }
}

let requestCache = {};
// Кеш загруженных заявок для показа модального окна без повторного запроса.

function getUserSearchParams() {
  // Возвращает параметры фильтрации из полей поиска.
  const status = document.getElementById('userStatusFilter').value;
  const params = {
    search: document.getElementById('userSearchInput').value.trim(),
    status
  };
  if (!status) {
    params.includeClosed = 'true';
  }
  return params;
}

async function loadUserRequests() {
  // Загрузка списка заявок пользователя и рендер карточек.
  const container = document.getElementById('myRequests');
  container.innerHTML = 'Загрузка...';

  try {
    const params = getUserSearchParams();
    const requests = await getMyRequests(params);
    if (!Array.isArray(requests) || requests.length === 0) {
      container.innerHTML = '<p>Заявок пока нет.</p>';
      return;
    }

    requestCache = {};
    container.innerHTML = requests.map(r => {
      requestCache[r.id] = r;
      const ageMinutes = Math.floor((Date.now() - r.createdAt) / 60000);
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
                    <div class="small-text">ID: ${r.id} · Создано: ${formatTimestamp(r.createdAt)} · ${formatAgeMinutes(ageMinutes)}</div>
                </div>
            </div>
        `;
    }).join('');
  } catch (error) {
    container.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
  }
}

function openRequestModal(requestId) {
  // Открывает модальное окно с подробностями выбранной заявки.
  const request = requestCache[requestId];
  if (!request) return;

  const modal = document.getElementById('requestModal');
  const content = modal.querySelector('.modal-content');
  const ageMinutes = Math.floor((Date.now() - request.createdAt) / 60000);
  const ratingRow = request.status === 'closed'
    ? request.rating
      ? `<div class="modal-row"><strong>Оценка:</strong> ${escapeHtml(request.rating)} / 5</div>`
      : `<div class="modal-row">
           <strong>Оценка выполненной работы:</strong>
           <div class="rating-inputs">
             <button type="button" class="rating-button rating-btn-1" data-value="1" onclick="selectRating(event, 1)">1</button>
             <button type="button" class="rating-button rating-btn-2" data-value="2" onclick="selectRating(event, 2)">2</button>
             <button type="button" class="rating-button rating-btn-3" data-value="3" onclick="selectRating(event, 3)">3</button>
             <button type="button" class="rating-button rating-btn-4" data-value="4" onclick="selectRating(event, 4)">4</button>
             <button type="button" class="rating-button rating-btn-5" data-value="5" onclick="selectRating(event, 5)">5</button>
           </div>
           <input type="hidden" id="selectedRating" value="">
         </div>`
    : '';
  const ratingButton = request.status === 'closed' && !request.rating
    ? `<button class="button-primary" id="ratingSubmitButton" onclick="submitRating(${request.id})" disabled>Оценить</button>`
    : '';

  content.innerHTML = `
    <div class="modal-body-grid">
      <div class="modal-main">
        <h3>${escapeHtml(request.title)}</h3>
        <div class="modal-meta">${formatStatus(request.status)} · ID: ${request.id}</div>
        <p class="modal-description">${escapeHtml(request.description)}</p>
        <div class="modal-row"><strong>Пользователь:</strong> ${escapeHtml(request.owner || 'Я')}</div>
        ${request.category
          ? `<div class="modal-row"><strong>Категория:</strong> ${escapeHtml(request.category)}</div>`
          : ''}
        ${request.priority
          ? `<div class="modal-row"><strong>Приоритет:</strong> ${escapeHtml(request.priority)}</div>`
          : ''}
        ${ratingRow}
        <div class="modal-actions">
          <button class="button-secondary modal-close-button" onclick="closeRequestModal()">Закрыть</button>
          ${ratingButton}
        </div>
      </div>
      <div class="modal-ai">
        <h4>Рекомендации AI</h4>
        ${(() => {
            let sols = Array.isArray(request.solutions) ? request.solutions : (() => { try { return JSON.parse(request.solutions || '[]'); } catch(e) { return []; } })();
            return Array.isArray(sols) && sols.length ? `<ol>${sols.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : '<p class="small-text">Рекомендации отсутствуют.</p>';
          })()}
      </div>
    </div>
  `;

    // Приведём solutions к массиву и подготовим поля
    let sols = Array.isArray(request.solutions) ? request.solutions : (() => { try { return JSON.parse(request.solutions || '[]'); } catch(e) { return []; } })();
    sols = Array.isArray(sols) ? sols : [];
    const hasSols = sols.length > 0;

    const categoryField = `<div class="modal-field"><span class="modal-field-label">Категория</span><span class="modal-field-value">${escapeHtml(request.category || '—')}</span></div>`;
    const priorityField = `<div class="modal-field"><span class="modal-field-label">Приоритет</span><span class="modal-field-value">${escapeHtml(request.priority || '—')}</span></div>`;
    const createdField = `<div class="modal-field"><span class="modal-field-label">Создано</span><span class="modal-field-value">${formatTimestamp(request.createdAt)}</span></div>`;
    const closedField = request.closedAt ? `<div class="modal-field"><span class="modal-field-label">Закрыто</span><span class="modal-field-value">${formatTimestamp(request.closedAt)}</span></div>` : '';

    let ratingField = '';
    if (request.status === 'closed') {
      if (request.rating) {
        ratingField = `<div class="modal-field"><span class="modal-field-label">Оценка</span><span class="modal-field-value">${escapeHtml(request.rating)} / 5</span></div>`;
      } else {
        ratingField = `
          <div class="modal-field">
            <span class="modal-field-label">Оценка</span>
            <span class="modal-field-value">
              <div class="rating-inputs">
                <button type="button" class="rating-button rating-btn-1" data-value="1" onclick="selectRating(event, 1)">1</button>
                <button type="button" class="rating-button rating-btn-2" data-value="2" onclick="selectRating(event, 2)">2</button>
                <button type="button" class="rating-button rating-btn-3" data-value="3" onclick="selectRating(event, 3)">3</button>
                <button type="button" class="rating-button rating-btn-4" data-value="4" onclick="selectRating(event, 4)">4</button>
                <button type="button" class="rating-button rating-btn-5" data-value="5" onclick="selectRating(event, 5)">5</button>
              </div>
              <input type="hidden" id="selectedRating" value="">
            </span>
          </div>`;
      }
    }

    const asideHtml = hasSols ? `
      <aside class="modal-aside">
        <div class="modal-aside-header">Рекомендации AI</div>
        <ol class="modal-solutions">
          ${sols.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
        </ol>
      </aside>` : '';

    content.innerHTML = `
      <div class="modal-layout">
        <div class="modal-main">
          <div class="modal-title-block">
            <h3 class="modal-title">${escapeHtml(request.title)}</h3>
            <div class="modal-meta">${formatStatus(request.status)} · ID: ${request.id}</div>
          </div>

          <p class="modal-description">${escapeHtml(request.description)}</p>

          <div class="modal-fields">
            <div class="modal-field"><span class="modal-field-label">Пользователь</span><span class="modal-field-value">${escapeHtml(request.owner || 'Я')}</span></div>
            ${categoryField}
            ${priorityField}
            ${createdField}
            ${closedField}
            ${ratingField}
          </div>

          <div class="modal-actions">
            <button class="button-secondary modal-close-button" onclick="closeRequestModal()">Закрыть</button>
            ${ratingButton}
          </div>
        </div>
        ${asideHtml}
      </div>
    `;

    // Если поле закрытия отсутствует, попробуем подгрузить из истории статусов
    if (request.status === 'closed' && !request.closedAt) {
      getHistory({ requestId: request.id }).then(rows => {
        if (!Array.isArray(rows) || rows.length === 0) return;
        const closedRow = rows.find(r => r.newStatus === 'closed' || r.note && r.note.toLowerCase().includes('closed')) || rows[0];
        if (!closedRow || !closedRow.changedAt) return;
        const modalFields = content.querySelector('.modal-fields');
        if (!modalFields) return;
        // Не добавляем, если уже есть поле Закрыто
        if (modalFields.querySelector('.modal-field span.modal-field-label') && Array.from(modalFields.querySelectorAll('.modal-field span.modal-field-label')).some(el => el.textContent === 'Закрыто')) return;
        const el = document.createElement('div');
        el.className = 'modal-field';
        el.innerHTML = `<span class="modal-field-label">Закрыто</span><span class="modal-field-value">${formatTimestamp(closedRow.changedAt)}</span>`;
        // Вставим после поля "Создано" если есть
        const fields = Array.from(modalFields.querySelectorAll('.modal-field'));
        const createdEl = fields.find(f => f.querySelector('.modal-field-label') && f.querySelector('.modal-field-label').textContent === 'Создано');
        if (createdEl && createdEl.parentNode) createdEl.parentNode.insertBefore(el, createdEl.nextSibling);
        else modalFields.appendChild(el);
      }).catch(() => {});
    }
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
  if (!modal || modal.classList.contains('closing')) return;
  modal.classList.add('closing');
  modal.classList.remove('show');
  window.setTimeout(() => {
    modal.classList.remove('closing');
    document.body.style.overflow = '';
  }, 260);
}

function closeRequestModal() {
  // Закрывает модальное окно.
  const modal = document.getElementById('requestModal');
  closeModal(modal);
}

// Обработка выбора рейтинга в модалке закрытой заявки.
function selectRating(event, value) {
  event.stopPropagation();
  document.querySelectorAll('.rating-button').forEach(button => {
    button.classList.toggle('selected', Number(button.dataset.value) === value);
  });
  const hidden = document.getElementById('selectedRating');
  const submitButton = document.getElementById('ratingSubmitButton');
  if (hidden) hidden.value = value;
  if (submitButton) submitButton.disabled = false;
}

async function submitRating(requestId) {
  const hidden = document.getElementById('selectedRating');
  if (!hidden || !hidden.value) {
    alert('Выберите оценку');
    return;
  }

  try {
    await rateRequestAPI(requestId, Number(hidden.value));
    alert('Оценка сохранена');
    loadUserRequests();
    closeRequestModal();
  } catch (error) {
    alert(error.message);
  }
}

function formatStatus(status) {
  // Преобразование внутреннего статуса в читаемый текст.
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
  return `${formatDurationWords(minutes)} назад`;
}

function formatTimestamp(value) {
  // Форматирование даты для отображения на странице.
  const date = new Date(value);
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function autoResizeTextarea(elementOrEvent) {
  const textarea = elementOrEvent.target || elementOrEvent;
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function escapeHtml(text) {
  // Защита от XSS: экранируем HTML-символы.
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function logout() {
  // Выход пользователя и переход на страницу авторизации.
  clearToken();
  window.location.href = 'auth.html';
}
