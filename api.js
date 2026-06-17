// api.js
// Общий API-слой для фронтенда. Обёртки выполняют запросы к бэкенду и
// обрабатывают токен авторизации, формат данных и ошибки.

// Константы конфигурации API и ключ хранения токена в браузере.
const API_BASE = '/api';
const TOKEN_KEY = 'supportSystemToken';

function getToken() {
  // Возвращает сохранённый токен из localStorage.
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  // Сохраняет токен при успешной авторизации.
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  // Удаляет токен при выходе или ошибке авторизации.
  localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch(path, options = {}) {
  // Базовый fetch, который добавляет заголовок Authorization и обрабатывает
  // ответ сервера, включая текстовые тела и JSON.
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      // window.location.href = 'auth.html';
      const err401 = new Error('Unauthorized');
      err401.status = 401;
      throw err401;
    }
    const err = new Error(data?.message || response.statusText || 'Ошибка сервера');
    // attach HTTP status and parsed body for consumers
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

function registerUser(username, password) {
  // Отправка запроса на регистрацию нового пользователя.
  return apiFetch('/register', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

function loginUser(username, password) {
  // Отправка данных для входа на сервер.
  return apiFetch('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

function getMe() {
  // Получение информации о текущем пользователе.
  return apiFetch('/me');
}

function getRequests(params = {}) {
  // Получение списка заявок с параметрами фильтрации.
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/requests?${query}`);
}

function getMyRequests(params = {}) {
  // Получение списка заявок текущего пользователя.
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/my-requests?${query}`);
}

function createRequestAPI(title, description) {
  // Создание новой заявки. Можно передать необязательные поля анализа от AI: category, priority, solutions
  const body = { title, description };
  // Если третий аргумент передаётся как объект — поддерживаем backward-compat
  if (arguments[2] && typeof arguments[2] === 'object') {
    Object.assign(body, arguments[2]);
  }

  return apiFetch('/requests', {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

function analyzeDescriptionAPI(description) {
  return apiFetch('/analyze', {
    method: 'POST',
    body: JSON.stringify({ description })
  });
}

function deleteRequestAPI(id) {
  // Удаление заявки по id.
  return apiFetch(`/requests/${id}`, {
    method: 'DELETE'
  });
}

function changeRequestStatusAPI(id, status) {
  // Обновление статуса заявки.
  return apiFetch(`/requests/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status })
  });
}
function assignRequestAPI(id, category, priority) {
  // Назначение категории и приоритета одновременно (для супер-админа).
  return apiFetch(`/requests/${id}/assign`, {
    method: 'PUT',
    body: JSON.stringify({ category, priority })
  });
}

function rateRequestAPI(id, rating) {
  // Отправка оценки закрытой заявки.
  return apiFetch(`/requests/${id}/rating`, {
    method: 'PUT',
    body: JSON.stringify({ rating })
  });
}

function getHistory(params = {}) {
  // Получение истории по заявкам (старый эндпоинт истории статусов).
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/history?${query}`);
}

function getClosedRequests(params = {}) {
  // Получение закрытых заявок для истории закрытий.
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/closed-requests?${query}`).then(data => Array.isArray(data) ? data : []);
}

function getSLAPredict(title) {
  const params = new URLSearchParams({ title: String(title || '') }).toString();
  return apiFetch(`/sla-predict?${params}`);
}

function getUsers() {
  // Получение списка пользователей для админской панели.
  return apiFetch('/users');
}

function createUserAPI({ username, password, role, responsibleCategory }) {
  // Создание нового пользователя администратора. Поддерживает responsibleCategory.
  const payload = { username, password, role };
  if (typeof responsibleCategory !== 'undefined') payload.responsibleCategory = responsibleCategory;
  return apiFetch('/users', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

function deleteUserAPI(id) {
  // Удаление пользователя по ID.
  return apiFetch(`/users/${id}`, {
    method: 'DELETE'
  });
}

function getOverviewData() {
  // Получение статистики для админской панели.
  return apiFetch('/overview');
}
