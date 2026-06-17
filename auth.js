// auth.js
// Логика страницы авторизации и регистрации. Здесь обрабатываются переключение
// между формами, регистрация, вход и перенаправление по роли пользователя.

// Инициализация страницы и проверка существующего токена.
async function initAuthPage() {
  // Если в локальном хранилище есть токен, пробуем проверить его и сразу перейти
  // на нужную страницу пользователя.
  const token = localStorage.getItem('supportSystemToken');
  if (token && token !== 'undefined' && token !== 'null') {
    try {
      const currentUser = await getMe();
      redirectByRole(currentUser.role);
      return;
    } catch (error) {
      clearToken();
    }
  }

  showLogin();
}

function showLogin() {
  // Показать форму входа и скрыть форму регистрации.
  document.getElementById('loginForm').classList.add('active');
  document.getElementById('registerForm').classList.remove('active');
  document.getElementById('loginTab').classList.add('active');
  document.getElementById('registerTab').classList.remove('active');
}

function showRegister() {
  // Показать форму регистрации и скрыть форму входа.
  document.getElementById('registerForm').classList.add('active');
  document.getElementById('loginForm').classList.remove('active');
  document.getElementById('registerTab').classList.add('active');
  document.getElementById('loginTab').classList.remove('active');
}

async function register() {
  // Собираем данные из формы регистрации и отправляем на сервер.
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value.trim();

  if (!username || !password) {
    alert('Заполните все поля');
    return;
  }

  try {
    await registerUser(username, password);
    alert('Аккаунт создан! Теперь войдите.');
    document.getElementById('regUsername').value = '';
    document.getElementById('regPassword').value = '';
    showLogin();
  } catch (error) {
    alert(error.message);
  }
}

async function login() {
  // Собираем данные со страницы входа и пытаемся выполнить аутентификацию.
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  if (!username || !password) {
    alert('Заполните все поля');
    return;
  }

  try {
    const data = await loginUser(username, password);
    setToken(data.token);
    redirectByRole(data.user.role);
  } catch (error) {
    alert(error.message);
  }
}

function redirectByRole(role) {
  // Перенаправление на соответствующую панель в зависимости от роли.
  if (role === 'admin') {
    window.location.href = 'dashboard_admin.html';
  } else {
    window.location.href = 'dashboard_user.html';
  }
}

function logout() {
  // Очистить токен и вернуться на страницу авторизации.
  clearToken();
  window.location.href = 'auth.html';
}
