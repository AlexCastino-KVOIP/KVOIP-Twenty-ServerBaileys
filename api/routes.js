import express from 'express';
import { createSession, getSession, getAllSessions, sessionQRCodes, deleteSession } from '../sessions/SessionManager.js';
import { saveSessionConfig } from '../sessions/SessionConfigManager.js';
import QRCode from 'qrcode';

const router = express.Router();

// Criar nova sessão
router.post('/session/:id', async (req, res) => {
  const id = req.params.id;
  const { webhook, workspaceID, canalID } = req.body;
  try {
    saveSessionConfig(id, { webhook, workspaceID, canalID });
    const sock = await createSession(id);
    res.json({ message: `Sessão ${id} criada ou recuperada com sucesso.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar sessão' });
  }
});

router.get('/session/status/:id', async (req, res) => {
  const id = req.params.id;
  const sock = getSession(id);
  if (!sock) return res.status(404).json({ error: 'Sessão não encontrada' });

  // Retorna apenas informações simples sobre a sessão
  res.json({
    session: id, // Nome da sessão
    connected: !!sock.user, // true se estiver conectada
    user: sock.user || null // Informações do usuário autenticado, se houver
  });
});

// Enviar mensagem
router.post('/session/:id/send', async (req, res) => {
  const id = req.params.id;
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Parâmetros "to" e "message" são obrigatórios' });
  }

  const sock = getSession(id);
  if (!sock) {
    return res.status(404).json({ error: 'Sessão não encontrada' });
  }

  try {
    await sock.sendMessage(to, { text: message });
    res.json({ message: 'Mensagem enviada com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

// Rota para obter QR code em texto (para frontend buscar)
router.get('/session/:id/qr', (req, res) => {
  const id = req.params.id;
  const qr = sessionQRCodes.get(id);
  if (qr) {
    res.json({ qr });
  } else {
    res.status(404).json({ error: 'QR code not found or already scanned' });
  }
});

// Rota para obter QR code em texto e SVG (imagem)
router.get('/session/:id/qr-image', async (req, res) => {
  const id = req.params.id;
  const qr = sessionQRCodes.get(id);
  if (!qr) {
    return res.status(404).json({ error: 'QR code not found or already scanned' });
  }
  try {
    // Gera SVG do QRCode
    const svg = await QRCode.toString(qr, { type: 'svg' });
    res.json({ qr, svg });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar imagem do QR code', details: err.message });
  }
});

// Rota para exibir o QRCode da sessão em uma página HTML
router.get('/session/:id/qr-view', (req, res) => {
  const sessionId = req.params.id;
  res.render('qr-view', { sessionId });
});

// Obter todas as sessões ativas
router.get('/sessions', (req, res) => {
  const all = getAllSessions();
  res.json({ sessions: all });
});

router.delete('/session/:id', (req, res) => {
  const id = req.params.id;
  // Remove a sessão usando a função do SessionManager
  const removed = deleteSession(id);
  if (removed) {
    res.json({ message: `Sessão ${id} removida com sucesso.` });
  } else {
    res.status(404).json({ error: 'Sessão não encontrada.' });
  }
});

export default router;
