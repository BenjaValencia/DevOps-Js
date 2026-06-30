const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8081;

// ==========================================
// Middleware - Configuración de Seguridad
// ==========================================
app.use(cors({
    origin: '*', // Permite peticiones desde cualquier origen (incluyendo tu frontend en Amazon S3)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());

// Declaramos 'db' que ahora almacenará el Pool de conexiones
let db;

async function initDB() {
    try {
        console.log('Verificando/Creando base de datos inicial...');
        
        // 1. Conexión temporal al motor para asegurar que exista la BD
        const connectionSetup = await mysql.createConnection({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD
        });
        
        const dbName = process.env.DB_NAME || 'users_db';
        await connectionSetup.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
        await connectionSetup.end(); 
        console.log(`Base de datos '${dbName}' verified con éxito.`);

        // 2. CREACIÓN DEL POOL (Reemplaza la conexión única e inestable)
        db = mysql.createPool({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: dbName,
            waitForConnections: true,
            connectionLimit: 10, // AWS Fargate manejará hasta 10 conexiones simultáneas por tarea
            queueLimit: 0,
            enableKeepAlive: true, // Crucial para AWS: evita que RDS corte el canal por inactividad
            keepAliveInitialDelay: 10000
        });
        console.log('Pool de conexiones MySQL inicializado correctamente');
        
        // Crear tabla si no existe (el Pool expone la función .execute igual que la conexión)
        await db.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Users table ready');

        // Check if users table is empty and seed if necessary
        const [rows] = await db.execute('SELECT COUNT(*) as count FROM users');
        if (rows[0].count === 0) {
            console.log('Seeding initial user...');
            await db.execute(
                'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
                ['admin', 'admin@example.com', 'admin123']
            );
            console.log('Initial user registered: admin / admin123');
        }
    } catch (error) {
        console.error('Database connection or initialization error:', error);
        process.exit(1);
    }
}

// Routes
app.post('/api/users/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
        }
        
        // El pool nos entrega una conexión sana de manera transparente aquí
        const [existingUser] = await db.execute(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );
        
        if (existingUser.length > 0) {
            return res.status(400).json({ error: 'El usuario o email ya existe' });
        }
        
        // Insert user
        const [result] = await db.execute(
            'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
            [username, email, password]
        );
        
        const [newUser] = await db.execute(
            'SELECT * FROM users WHERE id = ?',
            [result.insertId]
        );
        
        res.status(201).json(newUser[0]);
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const [users] = await db.execute('SELECT id, username, email, created_at FROM users');
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [users] = await db.execute(
            'SELECT id, username, email, created_at FROM users WHERE id = ?',
            [id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        res.json(users[0]);
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.get('/api/users/username/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const [users] = await db.execute(
            'SELECT id, username, email, created_at FROM users WHERE username = ?',
            [username]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        res.json(users[0]);
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const [result] = await db.execute(
            'DELETE FROM users WHERE id = ?',
            [id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Start server
initDB().then(() => {
    app.listen(port, () => {
        console.log(`Backend 1 (User Service) running on port ${port}`);
    });
});