// server.js
// Серверное приложение Express + SQLite. Здесь настроены маршруты API,
// аутентификация, связь с базой данных и логика работы заявок.

require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'support-system-secret';
const DB_FILE = path.join(__dirname, 'database.sqlite');

// Открываем SQLite базу данных.
const db = new sqlite3.Database(DB_FILE);

function run(sql, params = []) {
  // Выполнение запроса без возврата результата, обёртка Promise.
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  // Получение одной строки из базы.
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  // Получение массива строк из базы.
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initDb() {
  // Инициализация схемы базы данных при старте сервера.
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      userId INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      closedDurationMs INTEGER,
      rating INTEGER,
      category TEXT,
      priority TEXT,
      solutions TEXT,
      assignedTo TEXT,
      FOREIGN KEY(userId) REFERENCES users(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS request_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requestId INTEGER NOT NULL,
      requestTitle TEXT,
      requestOwnerId INTEGER,
      oldStatus TEXT,
      newStatus TEXT,
      changedAt INTEGER NOT NULL,
      changedBy INTEGER NOT NULL,
      note TEXT,
      FOREIGN KEY(requestId) REFERENCES requests(id),
      FOREIGN KEY(changedBy) REFERENCES users(id)
    );
  `);

  await run(`
    UPDATE requests
    SET closedDurationMs = (
      SELECT MAX(changedAt) - createdAt
      FROM request_history
      WHERE requestId = requests.id AND newStatus = 'closed'
    )
    WHERE status = 'closed' AND closedDurationMs IS NULL;
  `);

  const admin = await get('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!admin) {
    await run('INSERT INTO users (username, password, role, createdAt) VALUES (?, ?, ?, ?)', [
      'admin',
      bcrypt.hashSync('1234', 10),
      'admin',
      Date.now()
    ]);
  }
}

// Настройка Express: парсинг JSON и отдача статических файлов из корня проекта.
app.use(express.json());
app.use(express.static(__dirname));

function createToken(user) {
  // Создание JWT для авторизованного пользователя. Включаем `responsibleCategory`.
  return jwt.sign({ id: user.id, username: user.username, role: user.role, responsibleCategory: user.responsibleCategory || null }, SECRET, { expiresIn: '8h' });
}

async function authMiddleware(req, res, next) {
  // Проверка заголовка Authorization и декодирование JWT.
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, SECRET);
    // Если в токене нет responsibleCategory (старые токены), подгрузим из БД
    if (typeof req.user.responsibleCategory === 'undefined') {
      try {
        const u = await get('SELECT responsibleCategory FROM users WHERE id = ?', [req.user.id]);
        req.user.responsibleCategory = u ? u.responsibleCategory : null;
      } catch (e) {
        req.user.responsibleCategory = null;
      }
    }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  // Разрешение доступа только для админов.
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
}

// Маршруты регистрации и входа пользователя.
app.post('/api/register', async (req, res) => {
  // Регистрация нового пользователя.
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const existing = await get('SELECT id FROM users WHERE lower(username) = lower(?)', [username]);
    if (existing) {
      return res.status(409).json({ message: 'Пользователь уже существует' });
    }

    const hashed = bcrypt.hashSync(password, 10);
    const result = await run('INSERT INTO users (username, password, role, createdAt) VALUES (?, ?, ?, ?)', [
      username,
      hashed,
      'user',
      Date.now()
    ]);

    res.status(201).json({ id: result.lastID, username, role: 'user' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  // Вход пользователя по логину и паролю.
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ message: 'Неверный логин или пароль' });
    }

    res.json({ token: createToken(user), user: { id: user.id, username: user.username, role: user.role, responsibleCategory: user.responsibleCategory || null } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  // Получение данных текущего пользователя включая `responsibleCategory`.
  try {
    const user = await get('SELECT id, username, role, responsibleCategory FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Простое сопоставление категории заявки с ответственным специалистом или группой.
function assignSpecialistByCategory(category) {
  const map = {
    'Программное обеспечение': 'software-team',
    'Аппаратное обеспечение': 'hardware-team',
    'Сеть и интернет': 'network-team',
    'Информационная безопасность': 'security-team',
    'Другое': 'general-support'
  };
  return map[category] || 'general-support';
}

// Endpoint для анализа описания обращения с помощью Gemini (Google AI).
app.post('/api/analyze', authMiddleware, async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) {
      return res.status(400).json({ message: 'Description is required' });
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ message: 'AI API key not configured on server' });
    }

    // Новая логика: пробуем цепочку моделей последовательно без повторных попыток для каждой.
    const chainModels = [
      'gemini-3.5-flash',
      'gemini-2.5-flash',
      'gemini-3.1-flash-lite'
    ];

    // Для совместимости с владельцем окружения — оставляем переменную в логе,
    // но она больше не используется как первичная модель по умолчанию.
    const configuredModel = process.env.GEMINI_MODEL || null;

    const prompt = `Ты — аналитик службы технической поддержки. Проанализируй обращение пользователя и верни ТОЛЬКО валидный JSON без пояснений, markdown-разметки и блоков кода с полями: category (допустимые значения category (выбери наиболее подходящее): "Аппаратное обеспечение" — физическое оборудование, компьютеры, ноутбуки, "Программное обеспечение" — ошибки приложений, установка, лицензии, "Сеть и интернет" — подключение, VPN, Wi-Fi, сетевые диски, "Информационная безопасность" — вирусы, фишинг, подозрительная активность, "Другое" — если ни одна категория не подходит), priority (допустимые значения priority: "Критический" — полная остановка работы, бизнес-процессы заблокированы, "Высокий" — серьёзное нарушение работы, есть обходное решение, "Средний" — частичные неудобства, работа возможна, "Низкий" — несрочный вопрос, косметическая проблема), solutions (массив строк из 2-4 кратких рекомендаций). Рекомендации должны быть краткими утвердительными инструкциями (без вопросов). Текст: ${description}`;

    let data = null;
    let usedModel = null;
    let all429 = true;

    for (const m of chainModels) {
      const model = String(m).replace(/^\/+/, '');
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const body = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 }
        };

        const resFetch = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        console.log('Tried model', model, 'status', resFetch.status);

        if (resFetch.ok) {
          data = await resFetch.json();
          usedModel = model;
          all429 = false;
          console.log('AI model succeeded:', model);
          break;
        }

        // Не-успешный ответ — прочитаем тело для логов/анализа
        const txt = await resFetch.text();
        console.error('AI model returned non-ok', { model, status: resFetch.status, body: txt });

        if (resFetch.status === 429) {
          // rate limited — пробуем следующую модель
          console.warn('Model rate-limited, switching to next model:', model);
          // all429 остаётся true
          continue;
        }

        // Если получили серверную ошибку — также переключаемся на следующую модель
        if ([500, 502, 503, 504].includes(resFetch.status)) {
          all429 = false;
          console.warn('Server error from model, trying next model:', model);
          continue;
        }

        // Для любых остальных кодов ошибок — возвращаем их клиенту сразу
        return res.status(resFetch.status).json({ message: `AI API error: ${resFetch.status}`, details: txt });
      } catch (err) {
        // Ошибка сети/исключение — логируем и переходим к следующей модели
        all429 = false;
        console.error('Fetch error for model', m, err && err.message);
        continue;
      }
    }

    if (!data) {
      if (all429) {
        return res.status(429).json({ allModelsRateLimited: true, message: 'Все модели AI недоступны. Попробуйте через минуту.' });
      }
      return res.status(502).json({ message: 'AI models failed to produce a valid response' });
    }

    const aiResponseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || JSON.stringify(data);

    if (!aiResponseText) {
      return res.status(502).json({ message: 'Empty response from AI service', systemAction: 'Пустой ответ от AI — заявка будет создана без рекомендаций.' });
    }

    let parsed = null;
    try {
      parsed = JSON.parse(aiResponseText.trim());
    } catch (e) {
      const m = aiResponseText.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch (e2) { parsed = null; }
      }
    }

    if (!parsed || !parsed.category || !parsed.priority || !Array.isArray(parsed.solutions)) {
      return res.status(502).json({ message: 'AI returned invalid analysis', raw: aiResponseText, systemAction: 'Нейросеть вернула некорректный формат — заявка будет создана без рекомендаций.' });
    }

    res.json({ category: parsed.category, priority: parsed.priority, solutions: parsed.solutions, model: usedModel });
  } catch (err) {
    console.error('Analyze error', err);
    res.status(500).json({ message: 'Failed to analyze description', error: err.message });
  }
});


// Группа маршрутов работы с заявками: общий список, личные заявки, создание, удаление, изменение статуса и рейтинг.
app.get('/api/requests', authMiddleware, async (req, res) => {
  // Получение списка заявок с фильтрацией по тексту и статусу.
  try {
    const search = req.query.search ? `%${req.query.search.trim()}%` : '%';
    const statusFilter = req.query.status || '';
    
    if (req.user.role !== 'admin') {
      // ===== ДАШБОРД ПОЛЬЗОВАТЕЛЯ =====
      // Пользователь видит все свои заявки во всех статусах без скрытия
      const params = [search, search, req.user.id];
      let query = `
        SELECT r.*, u.username AS owner
        FROM requests r
        JOIN users u ON u.id = r.userId
        WHERE (LOWER(r.title) LIKE LOWER(?) OR LOWER(r.description) LIKE LOWER(?))
        AND r.userId = ?
      `;

      if (statusFilter) {
        query += ' AND r.status = ?';
        params.push(statusFilter);
      }

      query += ' ORDER BY r.createdAt DESC';
      const requests = await all(query, params);
      res.json(requests.map(r => {
        let sols = r.solutions;
        try {
          sols = sols ? JSON.parse(sols) : [];
        } catch (e) {
          sols = [];
        }
        return { ...r, createdAt: Number(r.createdAt), solutions: sols };
      }));
    } else {
      // ===== ДАШБОРД АДМИНА =====
      // Админ видит заявки других пользователей, закрытые скрываются через 60 сек
      const params = [search, search];
      let query = `
        SELECT r.*, u.username AS owner
        FROM requests r
        JOIN users u ON u.id = r.userId
        WHERE (LOWER(r.title) LIKE LOWER(?) OR LOWER(r.description) LIKE LOWER(?))
      `;

      if (statusFilter) {
        query += ' AND r.status = ?';
        params.push(statusFilter);
      } else {
        // Если нет фильтра - показывать открытые или недавно закрытые (в течение 60 сек)
        query += ' AND (r.status != ? OR (SELECT MAX(changedAt) FROM request_history WHERE requestId = r.id AND newStatus = ?) > ?)';
        params.push('closed', 'closed', Date.now() - 60 * 1000);
      }

      // Если у админа задана специализация — показываем только заявки этой категории
      if (req.user.role === 'admin' && req.user.responsibleCategory) {
        query += ' AND r.category = ?';
        params.push(req.user.responsibleCategory);
      }

      // Для супер-админа (admin без responsibleCategory) показываем сначала заявки без категории
      if (req.user.role === 'admin' && (req.user.responsibleCategory === null || typeof req.user.responsibleCategory === 'undefined')) {
        query += ' ORDER BY CASE WHEN r.category IS NULL OR r.category = "" THEN 0 ELSE 1 END ASC, r.createdAt DESC';
      } else {
        query += ' ORDER BY r.createdAt DESC';
      }
      const requests = await all(query, params);
      res.json(requests.map(r => ({ ...r, createdAt: Number(r.createdAt) })));
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/my-requests', authMiddleware, async (req, res) => {
  // Получение списка заявок текущего пользователя без скрытия закрытых.
  try {
    const search = req.query.search ? `%${req.query.search.trim()}%` : '%';
    const statusFilter = req.query.status || '';
    const params = [search, search, req.user.id];
    let query = `
      SELECT r.*, u.username AS owner
      FROM requests r
      JOIN users u ON u.id = r.userId
      WHERE (LOWER(r.title) LIKE LOWER(?) OR LOWER(r.description) LIKE LOWER(?))
      AND r.userId = ?
    `;

    if (statusFilter) {
      query += ' AND r.status = ?';
      params.push(statusFilter);
    }

    query += ' ORDER BY r.createdAt DESC';
    const requests = await all(query, params);
    res.json(requests.map(r => {
      let sols = r.solutions;
      try {
        sols = sols ? JSON.parse(sols) : [];
      } catch (e) {
        sols = [];
      }
      return { ...r, createdAt: Number(r.createdAt), solutions: sols };
    }));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/requests', authMiddleware, async (req, res) => {
  // Создание новой заявки и запись первого события в историю.
  try {
    const { title, description } = req.body;
    if (!title || !description) {
      return res.status(400).json({ message: 'Title and description are required' });
    }

    // Доп. поля от AI: category, priority, solutions
    const allowedCategories = [
      'Аппаратное обеспечение',
      'Программное обеспечение',
      'Сеть и интернет',
      'Информационная безопасность',
      'Другое'
    ];

    let { category, priority, solutions } = req.body;

    if (category && typeof category === 'string') {
      category = category.trim();
      if (!allowedCategories.includes(category)) {
        category = 'Другое';
      }
    } else {
      category = null;
    }

    if (priority && typeof priority === 'string') {
      priority = priority.trim();
    } else {
      priority = null;
    }

    if (solutions && Array.isArray(solutions)) {
      solutions = JSON.stringify(solutions.map(s => String(s)));
    } else {
      solutions = null;
    }

    const now = Date.now();
    const assignedTo = category ? assignSpecialistByCategory(category) : null;

    const result = await run(
      'INSERT INTO requests (title, description, status, userId, createdAt, category, priority, solutions, assignedTo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [title, description, 'new', req.user.id, now, category, priority, solutions, assignedTo]
    );

    await run(
      'INSERT INTO request_history (requestId, requestTitle, requestOwnerId, oldStatus, newStatus, changedAt, changedBy, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [result.lastID, title, req.user.id, null, 'new', now, req.user.id, 'Заявка создана']
    );

    res.status(201).json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/requests/:id', authMiddleware, async (req, res) => {
  // Удаление заявки и запись операции в историю.
  try {
    const id = Number(req.params.id);
    const request = await get('SELECT * FROM requests WHERE id = ?', [id]);
    if (!request) {
      return res.status(404).json({ message: 'Заявка не найдена' });
    }

    if (req.user.role !== 'admin' && request.userId !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await run(
      'INSERT INTO request_history (requestId, requestTitle, requestOwnerId, oldStatus, newStatus, changedAt, changedBy, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        request.title,
        request.userId,
        request.status,
        'deleted',
        Date.now(),
        req.user.id,
        req.user.role === 'admin' ? 'Удалена администратором' : 'Удалена пользователем'
      ]
    );
    await run('DELETE FROM requests WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

function translateStatus(status) {
  switch (status) {
    case 'new':
      return 'новая';
    case 'in progress':
      return 'в работе';
    case 'closed':
      return 'закрыта';
    case 'deleted':
      return 'удалена';
    default:
      return status;
  }
}

app.put('/api/requests/:id/status', authMiddleware, adminOnly, async (req, res) => {
  // Обновление статуса заявки и запись изменения в историю.
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const validStatuses = ['new', 'in progress', 'closed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Неверный статус' });
    }

    const request = await get('SELECT * FROM requests WHERE id = ?', [id]);
    if (!request) {
      return res.status(404).json({ message: 'Заявка не найдена' });
    }

    const now = Date.now();
    if (status === 'closed') {
      const closedDurationMs = now - request.createdAt;
      await run('UPDATE requests SET status = ?, closedDurationMs = ?, rating = rating WHERE id = ?', [status, closedDurationMs, id]);
    } else {
      await run('UPDATE requests SET status = ?, closedDurationMs = NULL, rating = NULL WHERE id = ?', [status, id]);
    }
    await run(
      'INSERT INTO request_history (requestId, requestTitle, requestOwnerId, oldStatus, newStatus, changedAt, changedBy, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        request.title,
        request.userId,
        request.status,
        status,
        now,
        req.user.id,
        `Статус изменён с "${translateStatus(request.status)}" на "${translateStatus(status)}"`
      ]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/requests/:id/rating', authMiddleware, async (req, res) => {
  // Пользователь ставит оценку закрытой заявке.
  try {
    const id = Number(req.params.id);
    const { rating } = req.body;
    const numericRating = Number(rating);

    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ message: 'Оценка должна быть целым числом от 1 до 5' });
    }

    const request = await get('SELECT * FROM requests WHERE id = ?', [id]);
    if (!request) {
      return res.status(404).json({ message: 'Заявка не найдена' });
    }
    if (request.userId !== req.user.id) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (request.status !== 'closed') {
      return res.status(400).json({ message: 'Оценку можно поставить только закрытой заявке' });
    }

    await run('UPDATE requests SET rating = ? WHERE id = ?', [numericRating, id]);
    res.json({ success: true, rating: numericRating });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/history', authMiddleware, async (req, res) => {
  // Старый маршрут истории статусов, оставлен только для совместимости.
  try {
    const requestId = req.query.requestId ? Number(req.query.requestId) : null;
    let query = `
      SELECT h.*, u.username AS changedByName,
        COALESCE(h.requestTitle, r.title) AS requestTitle,
        COALESCE(h.requestOwnerId, r.userId) AS ownerId
      FROM request_history h
      JOIN users u ON u.id = h.changedBy
      LEFT JOIN requests r ON r.id = h.requestId
      WHERE 1 = 1
    `;
    const params = [];

    if (requestId) {
      query += ' AND h.requestId = ?';
      params.push(requestId);
    }

    // Если админ со специализацией — ограничим историю заявками из этой категории
    if (req.user.role === 'admin' && req.user.responsibleCategory) {
      query += ' AND r.category = ?';
      params.push(req.user.responsibleCategory);
    }

    query += ' ORDER BY h.changedAt DESC';
    let rows = await all(query, params);

    if (req.user.role !== 'admin') {
      rows = rows.filter(row => row.ownerId === req.user.id || row.changedBy === req.user.id);
    }

    res.json(rows.map(formatHistoryRow));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/closed-requests', authMiddleware, async (req, res) => {
  // Возвращает список закрытых заявок с датой закрытия и временем обработки.
  try {
    let query = `
      SELECT r.id, r.title, r.description, r.status, r.createdAt, r.userId, u.username AS owner,
          h.changedAt AS closedAt, h.note AS closeNote,
          r.closedDurationMs,
          r.rating,
          r.category,
          r.priority,
          r.solutions
      FROM requests r
      JOIN users u ON u.id = r.userId
      JOIN request_history h ON h.requestId = r.id
      WHERE r.status = 'closed'
        AND h.newStatus = 'closed'
        AND h.changedAt = (
          SELECT MAX(changedAt)
          FROM request_history
          WHERE requestId = r.id AND newStatus = 'closed'
        )
    `;
    const params = [];

    if (req.user.role !== 'admin') {
      query += ' AND r.userId = ?';
      params.push(req.user.id);
    }

    // Если у админа задана специализация — показываем только заявки этой категории
    if (req.user.role === 'admin' && req.user.responsibleCategory) {
      query += ' AND r.category = ?';
      params.push(req.user.responsibleCategory);
    }

    query += ' ORDER BY h.changedAt DESC';
    const rows = await all(query, params);

    const result = rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      createdAt: Number(row.createdAt),
      owner: row.owner,
      closedAt: Number(row.closedAt),
      closedDuration: formatDuration(row.closedDurationMs),
      closeNote: row.closeNote,
      rating: row.rating,
      category: row.category || null,
      priority: row.priority || null,
      solutions: (() => {
        try {
          return row.solutions ? JSON.parse(row.solutions) : [];
        } catch (e) {
          return [];
        }
      })()
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Новый маршрут аналитики: усреднённые метрики и активные заявки по категориям
app.get('/api/analytics', authMiddleware, adminOnly, async (req, res) => {
  try {
    const categories = [
      'Аппаратное обеспечение',
      'Программное обеспечение',
      'Сеть и интернет',
      'Информационная безопасность',
      'Другое'
    ];

    // avgClosingTimeByCategory: среднее closedDurationMs (>0) по каждой категории
    const avgClosingTimeByCategory = {};
    for (const c of categories) {
      const row = await get(`SELECT AVG(closedDurationMs) as avgMs FROM requests WHERE status = 'closed' AND closedDurationMs > 0 AND category = ?`, [c]);
      avgClosingTimeByCategory[c] = row && row.avgMs !== null ? Math.round(row.avgMs) : null;
    }

    // avgRatingByCategory: средняя оценка среди закрытых заявок, где rating IS NOT NULL
    const avgRatingByCategory = {};
    for (const c of categories) {
      const row = await get(`SELECT AVG(rating) as avgRating FROM requests WHERE status = 'closed' AND rating IS NOT NULL AND category = ?`, [c]);
      avgRatingByCategory[c] = row && row.avgRating !== null ? Number(Number(row.avgRating).toFixed(2)) : null;
    }

    // activeRequestsByCategory: count запросов со статусом new или in progress
    const activeRequestsByCategory = {};
    for (const c of categories) {
      const row = await get(`SELECT COUNT(1) as cnt FROM requests WHERE status IN ('new','in progress') AND category = ?`, [c]);
      activeRequestsByCategory[c] = row ? Number(row.cnt) : 0;
    }

    // Также посчитаем для пустой/NULL категории — поместим под ключ 'Без категории'
    const nullRow = await get(`SELECT COUNT(1) as cnt FROM requests WHERE status IN ('new','in progress') AND (category IS NULL OR category = '')`, []);
    activeRequestsByCategory['Без категории'] = nullRow ? Number(nullRow.cnt) : 0;

    // For specialized admins return single-number aggregates filtered by their category
    let activeForCategory = null;
    let avgTimeForCategory = null;
    let avgRatingForCategory = null;
    const respCat = req.user && req.user.responsibleCategory ? req.user.responsibleCategory : null;
    if (respCat) {
      const aRow = await get(`SELECT COUNT(1) as cnt FROM requests WHERE status IN ('new','in progress') AND category = ?`, [respCat]);
      activeForCategory = aRow ? Number(aRow.cnt) : 0;
      const tRow = await get(`SELECT AVG(closedDurationMs) as avgMs FROM requests WHERE status = 'closed' AND closedDurationMs > 0 AND category = ?`, [respCat]);
      avgTimeForCategory = tRow && tRow.avgMs !== null ? Math.round(tRow.avgMs) : null;
      const rRow = await get(`SELECT AVG(rating) as avgRating FROM requests WHERE status = 'closed' AND rating IS NOT NULL AND category = ?`, [respCat]);
      avgRatingForCategory = rRow && rRow.avgRating !== null ? Number(Number(rRow.avgRating).toFixed(2)) : null;
    }

    res.json({ avgClosingTimeByCategory, avgRatingByCategory, activeRequestsByCategory, activeForCategory, avgTimeForCategory, avgRatingForCategory });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// Предсказание SLA по заголовку обращения
app.get('/api/sla-predict', authMiddleware, async (req, res) => {
  try {
    const title = (req.query.title || '').toString();
    const stopwords = new Set([
      'не','на','по','из','за','до','от','под','над','при','без','для','что','как','это','мой','моя','моё','мои','мне','его','её','их','все','всё','так','уже','или','но','да','нет','был','была','были','есть','нет','очень','ещё','когда','если','чтобы','тоже','себя','того','этот','эта','эти','один','два','три','после','перед','через','между','снова','просто','только','можно','нужно','работает','работал','работала','работают'
    ]);

    let words = title
      .toLowerCase()
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9а-яё\-]/gi, '').trim())
      .filter(w => w.length >= 3 && !stopwords.has(w));

    let rows = [];
    let isFallback = false;

    if (words.length > 0) {
      // Построим WHERE ... (LOWER(r.title) LIKE ? OR LOWER(r.description) LIKE ?) AND ...
      const parts = [];
      const params = [];
      words.forEach(w => {
        parts.push('(LOWER(r.title) LIKE ? OR LOWER(r.description) LIKE ?)');
        params.push(`%${w}%`, `%${w}%`);
      });
      const where = parts.join(' AND ');
      const sql = `SELECT r.closedDurationMs FROM requests r WHERE r.status = 'closed' AND r.closedDurationMs > 0 AND (${where})`;
      rows = await all(sql, params);

      // Если найдено мало записей, перейдём к глобальному фоллбеку
      if (!rows || rows.length < 5) {
        rows = await all("SELECT closedDurationMs FROM requests WHERE status = 'closed' AND closedDurationMs > 0");
        isFallback = true;
      }
    } else {
      // После фильтрации стоп-слов не осталось значимых слов — сразу фоллбек
      rows = await all("SELECT closedDurationMs FROM requests WHERE status = 'closed' AND closedDurationMs > 0");
      isFallback = true;
    }

    const durations = (rows || []).map(r => Number(r.closedDurationMs)).filter(v => !Number.isNaN(v) && v > 0);
    if (!durations || durations.length === 0) {
      return res.json({ median: null, count: 0, isFallback: true });
    }

    durations.sort((a, b) => a - b);
    const count = durations.length;
    let median = null;
    if (count % 2 === 1) {
      median = durations[(count - 1) / 2];
    } else {
      median = Math.round((durations[count / 2 - 1] + durations[count / 2]) / 2);
    }
    res.json({ median: median, count, isFallback });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Маршруты управления пользователями доступны только администратору.
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  // Получение списка пользователей и подсчёт количества заявок для каждого.
  try {
    const users = await all('SELECT id, username, role, createdAt, responsibleCategory FROM users ORDER BY createdAt DESC');
    const counts = await all('SELECT userId, COUNT(*) AS requestCount FROM requests GROUP BY userId');
    const countMap = counts.reduce((acc, item) => {
      acc[item.userId] = item.requestCount;
      return acc;
    }, {});

    res.json(users.map(user => ({ ...user, requestCount: countMap[user.id] || 0 })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { username, password, role, responsibleCategory } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ message: 'Необходимо указать логин, пароль и роль.' });
    }

    const exists = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) {
      return res.status(409).json({ message: 'Пользователь с таким логином уже существует.' });
    }

    // Валидация responsibleCategory: только для роли admin и только допустимые значения
    const allowedCategories = ['Аппаратное обеспечение', 'Программное обеспечение', 'Сеть и интернет', 'Информационная безопасность', 'Другое'];
    let catToStore = null;
    if (role === 'admin') {
      if (typeof responsibleCategory === 'string' && responsibleCategory.trim() !== '') {
        if (!allowedCategories.includes(responsibleCategory)) {
          return res.status(400).json({ message: 'Неправильная категория администратора' });
        }
        catToStore = responsibleCategory;
      } else {
        catToStore = null; // супер-админ
      }
    } else {
      catToStore = null; // для пользователей всегда NULL
    }

    const hashed = bcrypt.hashSync(password, 10);
    const createdAt = Date.now();
    const result = await run('INSERT INTO users (username, password, role, createdAt, responsibleCategory) VALUES (?, ?, ?, ?, ?)', [username, hashed, role, createdAt, catToStore]);

    res.json({ id: result.lastID, username, role, createdAt, responsibleCategory: catToStore });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'Неверный идентификатор пользователя.' });
    }

    if (id === req.user.id) {
      return res.status(400).json({ message: 'Нельзя удалить собственный аккаунт.' });
    }

    const user = await get('SELECT id, role FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден.' });
    }

    if (user.role === 'admin') {
      const adminCount = await get('SELECT COUNT(*) AS count FROM users WHERE role = ?', ['admin']);
      if (adminCount.count <= 1) {
        return res.status(400).json({ message: 'Нельзя удалить последнего администратора.' });
      }
    }

    const requestCount = await get('SELECT COUNT(*) AS count FROM requests WHERE userId = ?', [id]);
    if (requestCount.count > 0) {
      return res.status(400).json({ message: 'Нельзя удалить пользователя с существующими заявками.' });
    }

    await run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Маршрут админской статистики и общей сводки по системе.
app.get('/api/overview', authMiddleware, adminOnly, async (req, res) => {
  // Получение общей статистики по системе заявок.
  try {
    // Если у админа задана специализация — фильтруем все агрегаты по категории
    const cat = req.user && req.user.responsibleCategory ? req.user.responsibleCategory : null;
    const countsRows = cat
      ? await all('SELECT status, COUNT(*) AS count FROM requests WHERE category = ? GROUP BY status', [cat])
      : await all('SELECT status, COUNT(*) AS count FROM requests GROUP BY status');
    const counts = countsRows.reduce((acc, item) => ({ ...acc, [item.status]: item.count }), {});
    const totalRequestsRow = cat
      ? await get('SELECT COUNT(*) AS count FROM requests WHERE category = ?', [cat])
      : await get('SELECT COUNT(*) AS count FROM requests');
    const totalUsersRow = await get('SELECT COUNT(*) AS count FROM users');
    const overdueNewRow = cat
      ? await get('SELECT COUNT(*) AS count FROM requests WHERE status = ? AND createdAt < ? AND category = ?', [
          'new',
          Date.now() - 10 * 60000,
          cat
        ])
      : await get('SELECT COUNT(*) AS count FROM requests WHERE status = ? AND createdAt < ?', [
          'new',
          Date.now() - 10 * 60000
        ]);
    const newestRequestRow = cat
      ? await get('SELECT createdAt FROM requests WHERE category = ? ORDER BY createdAt DESC LIMIT 1', [cat])
      : await get('SELECT createdAt FROM requests ORDER BY createdAt DESC LIMIT 1');
    const averageRow = cat
      ? await get(
          'SELECT AVG(CAST(closedDurationMs AS REAL)) / 60000.0 AS avgClosedDuration FROM requests WHERE status = ? AND closedDurationMs IS NOT NULL AND category = ?',
          ['closed', cat]
        )
      : await get(
          'SELECT AVG(CAST(closedDurationMs AS REAL)) / 60000.0 AS avgClosedDuration FROM requests WHERE status = ? AND closedDurationMs IS NOT NULL',
          ['closed']
        );
    const averageAge = averageRow && averageRow.avgClosedDuration
      ? Math.round(averageRow.avgClosedDuration)
      : 0;
    const ratingRows = cat
      ? await all('SELECT rating, COUNT(*) AS count FROM requests WHERE status = ? AND rating IS NOT NULL AND category = ? GROUP BY rating', ['closed', cat])
      : await all('SELECT rating, COUNT(*) AS count FROM requests WHERE status = ? AND rating IS NOT NULL GROUP BY rating', ['closed']);
    const ratingCounts = ratingRows.reduce((acc, row) => {
      acc[row.rating] = row.count;
      return acc;
    }, {});
    const ratedRequestsRow = cat
      ? await get('SELECT COUNT(*) AS count FROM requests WHERE rating IS NOT NULL AND category = ?', [cat])
      : await get('SELECT COUNT(*) AS count FROM requests WHERE rating IS NOT NULL');

    res.json({
      counts,
      totalRequests: totalRequestsRow.count,
      totalUsers: totalUsersRow.count,
      overdueNew: overdueNewRow.count,
      averageAge,
      newestRequest: newestRequestRow ? newestRequestRow.createdAt : null,
      ratingCounts,
      ratedCount: ratedRequestsRow.count
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

function formatHistoryRow(row) {
  // Преобразует строку истории в удобный объект для JSON.
  return {
    id: row.id,
    requestId: row.requestId,
    requestTitle: row.requestTitle,
    oldStatus: row.oldStatus,
    newStatus: row.newStatus,
    note: row.note,
    changedAt: Number(row.changedAt),
    changedBy: row.changedByName
  };
}

function formatDuration(ms) {
  // Форматирует время в минутах и часах для отображения.
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) {
    return `${totalMinutes} мин`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`;
}

app.put('/api/requests/:id/category', authMiddleware, adminOnly, async (req, res) => {
  // Переназначение категории заявки (только супер-админ — admin без responsibleCategory)
  try {
    if (req.user.responsibleCategory !== null && typeof req.user.responsibleCategory !== 'undefined') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid request id' });

    const { category } = req.body;
    const allowedCategories = [
      'Аппаратное обеспечение',
      'Программное обеспечение',
      'Сеть и интернет',
      'Информационная безопасность',
      'Другое'
    ];

    if (!category || typeof category !== 'string' || !allowedCategories.includes(category)) {
      return res.status(400).json({ message: 'Invalid category' });
    }

    const request = await get('SELECT * FROM requests WHERE id = ?', [id]);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    const assignedTo = assignSpecialistByCategory(category);
    await run('UPDATE requests SET category = ?, assignedTo = ? WHERE id = ?', [category, assignedTo, id]);

    const now = Date.now();
    await run(
      'INSERT INTO request_history (requestId, requestTitle, requestOwnerId, oldStatus, newStatus, changedAt, changedBy, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, request.title, request.userId, request.status, request.status, now, req.user.id, `Категория изменена на "${category}"`]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/requests/:id/priority', authMiddleware, adminOnly, async (req, res) => {
  // Переназначение приоритета заявки (только супер-админ — admin без responsibleCategory)
  try {
    if (req.user.responsibleCategory !== null && typeof req.user.responsibleCategory !== 'undefined') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid request id' });

    const { priority } = req.body;
    const allowedPriorities = ['Низкий', 'Средний', 'Высокий', 'Критический'];

    if (!priority || typeof priority !== 'string' || !allowedPriorities.includes(priority)) {
      return res.status(400).json({ message: 'Invalid priority' });
    }

    const request = await get('SELECT * FROM requests WHERE id = ?', [id]);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    await run('UPDATE requests SET priority = ? WHERE id = ?', [priority, id]);

    const now = Date.now();
    await run(
      'INSERT INTO request_history (requestId, requestTitle, requestOwnerId, oldStatus, newStatus, changedAt, changedBy, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, request.title, request.userId, request.status, request.status, now, req.user.id, `Приоритет изменён на "${priority}"`]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/requests/:id/assign', authMiddleware, adminOnly, async (req, res) => {
  // Назначение категории и приоритета одновременно (только супер-админ)
  try {
    if (req.user.responsibleCategory !== null && typeof req.user.responsibleCategory !== 'undefined') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid request id' });

    const { category, priority } = req.body;
    const allowedCategories = [
      'Аппаратное обеспечение',
      'Программное обеспечение',
      'Сеть и интернет',
      'Информационная безопасность',
      'Другое'
    ];
    const allowedPriorities = ['Низкий', 'Средний', 'Высокий', 'Критический'];

    if (!category || typeof category !== 'string' || !allowedCategories.includes(category)) {
      return res.status(400).json({ message: 'Invalid category' });
    }
    if (!priority || typeof priority !== 'string' || !allowedPriorities.includes(priority)) {
      return res.status(400).json({ message: 'Invalid priority' });
    }

    const request = await get('SELECT * FROM requests WHERE id = ?', [id]);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    const assignedTo = assignSpecialistByCategory(category);
    await run('UPDATE requests SET category = ?, priority = ?, assignedTo = ? WHERE id = ?', [category, priority, assignedTo, id]);

    const now = Date.now();
    await run(
      'INSERT INTO request_history (requestId, requestTitle, requestOwnerId, oldStatus, newStatus, changedAt, changedBy, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, request.title, request.userId, request.status, request.status, now, req.user.id, `Категория и приоритет назначены: "${category}", "${priority}"`]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('*', (req, res) => {
  // Любой другой маршрут отдаёт страницу авторизации.
  res.sendFile(path.join(__dirname, 'auth.html'));
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server started at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database', err);
    process.exit(1);
  });
