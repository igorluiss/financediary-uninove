const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// 📘 Banco de dados
const dbFile = path.join(__dirname, "db.sqlite");
const db = new sqlite3.Database(dbFile);

// Criação das tabelas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS finances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    renda REAL,
    fixos REAL,
    lazer REAL,
    poupanca REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// 🧱 Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: __dirname }),
    secret: "segredo-seguro",
    resave: false,
    saveUninitialized: false
  })
);
app.use("/public", express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// 🔐 Verifica login
function ensureAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect("/login");
}

// Função de análise 50-30-20
function analisar503020(renda, fixos, lazer, poupanca) {
  const metaFixos = renda * 0.5;
  const metaLazer = renda * 0.3;
  const metaPoup = renda * 0.2;
  const msgs = [];

  if (fixos > metaFixos) msgs.push("Gastos fixos acima de 50% da renda.");
  if (lazer > metaLazer) msgs.push("Gastos de lazer acima de 30%.");
  if (poupanca < metaPoup) msgs.push("Poupe pelo menos 20% da renda.");

  const conforme = msgs.length === 0;
  const mensagem = conforme
    ? "Parabéns! Seus gastos estão dentro do método 50-30-20."
    : "Atenção! Alguns gastos estão fora do recomendado.";
  return { mensagem, msgs };
}

// 🏠 Rota inicial
app.get("/", (req, res) => {
  res.render("index", { user: req.session.user });
});

// 🔑 Cadastro (GET)
app.get("/register", (req, res) => {
  res.render("register", { error: null, user: req.session.user });
});

// 🔑 Cadastro (POST)
app.post("/register", (req, res) => {
  const { username, password } = req.body;
  const password_hash = bcrypt.hashSync(password, 10);

  db.run(
    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
    [username, password_hash],
    function (err) {
      if (err) {
        return res.render("register", {
          error: "Usuário já existe.",
          user: req.session.user
        });
      }
      res.redirect("/login");
    }
  );
});

// 🔓 Login (GET)
app.get("/login", (req, res) => {
  res.render("login", { error: null, user: req.session.user });
});

// 🔓 Login (POST)
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.render("login", {
        error: "Usuário ou senha inválidos.",
        user: req.session.user
      });

    req.session.user = { id: user.id, username: user.username };
    res.redirect("/dashboard");
  });
});

// 🚪 Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// 📊 Dashboard
app.get("/dashboard", ensureAuth, (req, res) => {
  db.all(
    "SELECT * FROM finances WHERE user_id = ? ORDER BY datetime(created_at) DESC",
    [req.session.user.id],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.send("Erro ao carregar dados");
      }
      res.render("dashboard", { user: req.session.user, rows, analise: null });
    }
  );
});

// 👤 Página de perfil
app.get("/perfil", ensureAuth, (req, res) => {
  res.render("perfil", { user: req.session.user });
});

// 🔑 Atualizar senha
app.post("/update-password", ensureAuth, (req, res) => {
  const { newPassword } = req.body;
  const hash = bcrypt.hashSync(newPassword, 10);

  db.run(
    "UPDATE users SET password_hash = ? WHERE id = ?",
    [hash, req.session.user.id],
    () => {
      res.redirect("/perfil");
    }
  );
});

// ❌ Excluir conta
app.post("/delete-account", ensureAuth, (req, res) => {
  const userId = req.session.user.id;

  db.run("DELETE FROM finances WHERE user_id = ?", [userId], () => {
    db.run("DELETE FROM users WHERE id = ?", [userId], () => {
      req.session.destroy(() => res.redirect("/"));
    });
  });
});


// ✏️ Atualizar username
app.post("/update-username", ensureAuth, (req, res) => {
  const { newUsername } = req.body;

  db.run(
    "UPDATE users SET username = ? WHERE id = ?",
    [newUsername, req.session.user.id],
    () => {
      req.session.user.username = newUsername; // ✅ Atualiza sessão
      res.redirect("/perfil");
    }
  );
});

// 🔑 Atualizar senha
app.post("/update-password", ensureAuth, (req, res) => {
  const { newPassword } = req.body;
  const hash = bcrypt.hashSync(newPassword, 10);

  db.run(
    "UPDATE users SET password_hash = ? WHERE id = ?",
    [hash, req.session.user.id],
    () => {
      res.redirect("/perfil");
    }
  );
});

// ❌ Excluir conta
app.post("/delete-account", ensureAuth, (req, res) => {
  const id = req.session.user.id;

  db.run("DELETE FROM finances WHERE user_id = ?", [id], () => {
    db.run("DELETE FROM users WHERE id = ?", [id], () => {
      req.session.destroy(() => res.redirect("/"));
    });
  });
});



// 💾 Salvar finanças (única rota correta)
app.post("/finances", ensureAuth, (req, res) => {
  const { renda, fixos, lazer, poupanca } = req.body;

  db.run(
    "INSERT INTO finances (user_id, renda, fixos, lazer, poupanca) VALUES (?,?,?,?,?)",
    [req.session.user.id, renda, fixos, lazer, poupanca],
    function (err) {
      if (err) {
        console.error(err);
        return res.send("Erro ao salvar dados");
      }

      const analise = analisar503020(
        parseFloat(renda),
        parseFloat(fixos),
        parseFloat(lazer),
        parseFloat(poupanca)
      );

      db.all(
        "SELECT * FROM finances WHERE user_id = ? ORDER BY datetime(created_at) DESC",
        [req.session.user.id],
        (err, rows) => {
          if (err) console.error(err);
          // Mostra a data imediatamente, sem precisar atualizar
          res.render("dashboard", {
            user: req.session.user,
            rows,
            analise
          });
        }
      );
    }
  );
});

// ➕ Abrir página de edição
app.get("/finances/edit/:id", ensureAuth, (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM finances WHERE id = ? AND user_id = ?", [id, req.session.user.id], (err, finance) => {
    if (!finance) return res.redirect("/dashboard");
    res.render("edit-finance", { finance });
  });
});

// ✏ Salvar alterações
app.post("/finances/update/:id", ensureAuth, (req, res) => {
  const id = req.params.id;
  const { renda, fixos, lazer, poupanca } = req.body;

  db.run(
    "UPDATE finances SET renda = ?, fixos = ?, lazer = ?, poupanca = ? WHERE id = ? AND user_id = ?",
    [renda, fixos, lazer, poupanca, id, req.session.user.id],
    () => res.redirect("/dashboard")
  );
});

// ❌ Excluir lançamento
app.post("/finances/delete/:id", ensureAuth, (req, res) => {
  db.run(
    "DELETE FROM finances WHERE id = ? AND user_id = ?",
    [req.params.id, req.session.user.id],
    () => res.redirect("/dashboard")
  );
});

// ✅ Exportar PDF com tabela
app.get("/export/pdf", (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ margin: 40 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=historico_financeiro.pdf");

  doc.pipe(res);

  doc
    .fontSize(22)
    .fillColor("#0A2E73")
    .text("Histórico Financeiro", { align: "center" });

  doc.moveDown(2);

  db.all(
    "SELECT * FROM finances WHERE user_id = ? ORDER BY datetime(created_at) DESC",
    [req.session.user.id],
    (err, rows) => {
      if (err) return res.redirect("/dashboard");

      const headers = ["Data", "Renda (R$)", "Fixos (R$)", "Lazer (R$)", "Poupança (R$)"];

      const startX = 50;
      let posY = 120;

      doc.rect(startX, posY - 5, 500, 25).fill("#0A2E73");
      doc.fillColor("#ffffff").fontSize(12);
      doc.text(headers[0], startX + 5, posY);
      doc.text(headers[1], startX + 110, posY);
      doc.text(headers[2], startX + 210, posY);
      doc.text(headers[3], startX + 310, posY);
      doc.text(headers[4], startX + 410, posY);

      doc.fillColor("black");

      posY += 30;

      rows.forEach((row) => {
        const dataFormatada = new Date(row.created_at).toLocaleDateString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        });

        doc.fontSize(11)
          .text(dataFormatada, startX + 5, posY)
          .text(`R$ ${row.renda}`, startX + 110, posY)
          .text(`R$ ${row.fixos}`, startX + 210, posY)
          .text(`R$ ${row.lazer}`, startX + 310, posY)
          .text(`R$ ${row.poupanca}`, startX + 410, posY);

        posY += 25;
        doc.moveTo(startX, posY).lineTo(550, posY).stroke();
        posY += 10;
      });

      doc.end();
    }
  );
});




app.listen(PORT, () =>
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`)
);
