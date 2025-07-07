import express from 'express';
import routes from './api/routes.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.json());
app.use('/api', routes);

app.listen(3002, () => console.log('API WhatsApp ouvindo na porta 3001'));
