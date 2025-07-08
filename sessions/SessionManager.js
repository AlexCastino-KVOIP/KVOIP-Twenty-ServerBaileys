//import makeWASocket , { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { makeWASocket, useMultiFileAuthState, Browsers, downloadMediaMessage } from '@whiskeysockets/baileys';
import P from 'pino';
import QRCode from 'qrcode-terminal';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
// Importa o gerenciador de configuração de sessão
import { getSessionConfig } from './SessionConfigManager.js';

const sessions = new Map();
const sessionQRCodes = new Map(); // Adiciona cache de QRCode
const sessionsToBeDeleted = new Set();

export async function createSession(name) {
  if (sessions.has(name)) {
    return sessions.get(name);
  }
  // Recupera a configuração da sessão (webhook, workspaceID, canalID)
  const config = getSessionConfig(name);
  // Endereço base fixo do webhook
  const baseURL = 'http://kvoip.localhost:3000/whatsapp/webhook';
  // Monta o endpoint dinamicamente, se workspaceID e canalID existirem
  let EndPointCRM = baseURL;
  if (config) {
    if (config.workspaceID && config.canalID) {
      EndPointCRM = `${baseURL}/${config.workspaceID}/${config.canalID}`;
    } else if (config.webhook) {
      // Se não houver workspaceID/canalID, mas houver webhook customizado
      EndPointCRM = config.webhook;
    }
  }

  // Cria uma pasta para a sessão e carrega/guarda as credenciais em arquivos separados
  const { state, saveCreds } = await useMultiFileAuthState(`./sessions_data/${name}`);

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.macOS('Google Chrome'),
    logger: P({ level: 'silent' }),
    getMessage: async (key) => {
      // Retorne a mensagem salva pelo ID, ou null se não existir
      return null;
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      sessionQRCodes.set(name, qr); // Salva o QRCode
      // Só mostra o QRCode se não estiver sendo deletada
      if (!sessionsToBeDeleted.has(name)) {
        console.log(`Session ${name} QR code:`);
        QRCode.generate(qr, { small: true });
      }
    }
    if (connection === 'open') {
      sessionQRCodes.delete(name); // Limpa QRCode após login
      console.log(`Session ${name} connected!`);
    }
    if (connection === 'close') {
      console.log(`Session ${name} disconnected!`);
      // Remove a sessão antiga do Map
      sessions.delete(name);

      // Verifica se o erro exige restart
      const shouldRestart = lastDisconnect?.error?.output?.statusCode !== 401
        || (lastDisconnect?.error?.message && lastDisconnect.error.message.includes('restart required'));

      // Só reinicia se não estiver marcada para exclusão
      if (shouldRestart && !sessionsToBeDeleted.has(name)) {
        setTimeout(() => createSession(name), 2000);
      }
    }
  });
  sock.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type == "notify") { // novas mensagens
      for (const message of messages) {
        let mensagem = null;
        // Tenta extrair o texto da mensagem de diferentes formas
        if (message.message && !message.key.remoteJid.includes('@g.us')) {
          if (message.message.conversation) {
            mensagem = message.message.conversation;
          } else if (message.message.extendedTextMessage && message.message.extendedTextMessage.text) {
            mensagem = message.message.extendedTextMessage.text;
          } else if (message.message.imageMessage && message.message.imageMessage.caption) {
            mensagem = message.message.imageMessage.caption;
          } else if (message.message.videoMessage && message.message.videoMessage.caption) {
            mensagem = message.message.videoMessage.caption;
          } // Adicione outros tipos conforme necessário
        }

        // Função auxiliar para determinar pasta e nome do arquivo baseado no tipo de mensagem
        const getPastaENomeArquivo = (message, extensao, tipoMensagem) => {
          const isStatus = message.key.remoteJid.includes('status');
          const pastaBase = './arquivos_recebidos';
          const pasta = isStatus ? path.join(pastaBase, 'status') : pastaBase;
          
          // Cria nome do arquivo com informações adicionais para status
          let nomeArquivo = message.key.id;
          if (isStatus) {
            const sessao = name;
            const pushName = message.pushName || 'sem_nome';
            nomeArquivo = `${sessao}_${pushName}_${message.key.id}`;
          }
          
          return {
            pasta,
            nomeArquivo: `${nomeArquivo}.${extensao}`,
            caminhoCompleto: path.join(pasta, `${nomeArquivo}.${extensao}`)
          };
        };

        // Exibe log se for mensagem de grupo
        if (message.key.remoteJid.includes('@g.us') && !message.key.remoteJid.includes('newsletter')) {
          console.log(`📩✍️ Mensagem de grupo para sessão: ${name} \nMensagem Filtrada: \n Usuario: ${message.key.remoteJid} \n Nome: ${message.pushName} \n Mensagem: ${mensagem}`);
        }

        // Trata mensagens de imagem separadamente, conforme padrão da API oficial do WhatsApp
        if (message.message && message.message.imageMessage && !message.key.remoteJid.includes('newsletter')) {
          // Extrai informações da imagem
          const img = message.message.imageMessage;
          const wa_id = message.key.remoteJid.split('@')[0];
          const { pasta, nomeArquivo, caminhoCompleto } = getPastaENomeArquivo(message, 'jpg', 'imagem');

          // Cria a pasta se não existir
          if (!fs.existsSync(pasta)) {
            fs.mkdirSync(pasta, { recursive: true });
          }

          // Baixa a imagem corretamente usando a função do Baileys
          let buffer = null;
          try {
            // downloadMediaMessage retorna um buffer com o conteúdo da imagem já decodificado
            buffer = await downloadMediaMessage(
              message,
              'buffer',
              {},
              { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
            );
            fs.writeFileSync(caminhoCompleto, buffer);
            console.log(`Imagem salva em: ${caminhoCompleto}`);
          } catch (err) {
            console.log('Erro ao baixar/salvar imagem:', err.message);
          }

          // Converte o buffer da imagem para base64
          let base64String = '';
          if (buffer) {
            base64String = `data:${img.mimetype};base64,${buffer.toString('base64')}`;
          }
          //console.log('Imagem: \n\n\n\n', base64String)

          // Monta o payload no formato esperado pela API oficial do WhatsApp (Meta), mas enviando a imagem em base64
          const payload = {
            object: "whatsapp_business_account",
            entry: [
              {
                id: name, // Aqui pode ser o id da conta, se disponível
                changes: [
                  {
                    value: {
                      messaging_product: "whatsapp",
                      metadata: {
                        display_phone_number: name,
                        phone_number_id: name
                      },
                      contacts: [
                        {
                          profile: {
                            name: message.pushName || ""
                          },
                          wa_id: wa_id
                        }
                      ],
                      messages: [
                        {
                          from: wa_id,
                          id: message.key.id,
                          timestamp: message.messageTimestamp?.toString() || "",
                          type: "image",
                          image: {
                            mime_type: img.mimetype,
                            sha256: img.fileSha256,
                            caption: img.caption || "",
                            base64: base64String // Envia a imagem em base64
                          }
                        }
                      ]
                    },
                    field: "messages"
                  }
                ]
              }
            ]
          };
 
          // Envia o payload para a API de destino
          try {
            //console.log(`Payload: ${JSON.stringify(payload)}`);
            await axios.post(EndPointCRM, payload);
          } catch (err) {
            console.log('Erro ao enviar payload para API:', err.message);
          }
          continue; // já tratou, não precisa cair no else de não mapeada
        }

        // Trata mensagens de vídeo separadamente, conforme padrão da API oficial do WhatsApp
        if (message.message && message.message.videoMessage && !message.key.remoteJid.includes('newsletter')) {
          // Extrai informações do vídeo
          const vid = message.message.videoMessage;
          const wa_id = message.key.remoteJid.split('@')[0];
          const { pasta, nomeArquivo, caminhoCompleto } = getPastaENomeArquivo(message, 'mp4', 'video');

          // Cria a pasta se não existir
          if (!fs.existsSync(pasta)) {
            fs.mkdirSync(pasta, { recursive: true });
          }

          // Baixa o vídeo corretamente usando a função do Baileys
          let buffer = null;
          try {
            // downloadMediaMessage retorna um buffer com o conteúdo do vídeo já decodificado
            buffer = await downloadMediaMessage(
              message,
              'buffer',
              {},
              { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
            );
            fs.writeFileSync(caminhoCompleto, buffer);
            console.log(`Vídeo salvo em: ${caminhoCompleto}`);
          } catch (err) {
            console.log('Erro ao baixar/salvar vídeo:', err.message);
          }

          // Converte o buffer do vídeo para base64
          let base64String = '';
          if (buffer) {
            base64String = `data:${vid.mimetype};base64,${buffer.toString('base64')}`;
          }

          // Monta o payload no formato esperado pela API oficial do WhatsApp (Meta), mas enviando o vídeo em base64
          const payload = {
            object: "whatsapp_business_account",
            entry: [
              {
                id: name, // Aqui pode ser o id da conta, se disponível
                changes: [
                  {
                    value: {
                      messaging_product: "whatsapp",
                      metadata: {
                        display_phone_number: name,
                        phone_number_id: name
                      },
                      contacts: [
                        {
                          profile: {
                            name: message.pushName || ""
                          },
                          wa_id: wa_id
                        }
                      ],
                      messages: [
                        {
                          from: wa_id,
                          id: message.key.id,
                          timestamp: message.messageTimestamp?.toString() || "",
                          type: "video",
                          video: {
                            mime_type: vid.mimetype,
                            sha256: vid.fileSha256,
                            caption: vid.caption || "",
                            base64: base64String // Envia o vídeo em base64
                          }
                        }
                      ]
                    },
                    field: "messages"
                  }
                ]
              }
            ]
          };

          // Envia o payload para a API de destino
          try {
            //console.log(`Payload: ${JSON.stringify(payload)}`);
            await axios.post(EndPointCRM, payload);
          } catch (err) {
            console.log('Erro ao enviar payload para API:', err.message);
          }
          continue; // já tratou, não precisa cair no else de não mapeada
        }

        // Trata mensagens de documentos PDF, Excel, CSV e TXT separadamente
        if (
          message.message &&
          message.message.documentMessage &&
          (
            message.message.documentMessage.mimetype === 'application/pdf' || // pdf
            message.message.documentMessage.mimetype === 'application/vnd.ms-excel' || // xls
            message.message.documentMessage.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || // xlsx
            message.message.documentMessage.mimetype === 'text/csv' || // csv
            message.message.documentMessage.mimetype === 'text/plain'   // txt
          ) &&
          !message.key.remoteJid.includes('newsletter')
        ) {
          // Extrai informações do documento
          const doc = message.message.documentMessage;
          const wa_id = message.key.remoteJid.split('@')[0];
          const extensao = doc.fileName ? path.extname(doc.fileName) : '.pdf';
          const { pasta, nomeArquivo, caminhoCompleto } = getPastaENomeArquivo(message, extensao.substring(1), 'documento');

          // Cria a pasta se não existir
          if (!fs.existsSync(pasta)) {
            fs.mkdirSync(pasta, { recursive: true });
          }

          // Baixa o arquivo corretamente usando a função do Baileys
          let buffer = null;
          try {
            // downloadMediaMessage retorna um buffer com o conteúdo do arquivo já decodificado
            buffer = await downloadMediaMessage(
              message,
              'buffer',
              {},
              { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
            );
            fs.writeFileSync(caminhoCompleto, buffer);
            console.log(`Arquivo salvo em: ${caminhoCompleto}`);
          } catch (err) {
            console.log('Erro ao baixar/salvar arquivo:', err.message);
          }

          // Converte o buffer do arquivo para base64
          let base64String = '';
          if (buffer) {
            base64String = `data:${doc.mimetype};base64,${buffer.toString('base64')}`;
          }

          // Monta o payload no formato esperado, enviando o arquivo em base64
          const payload = {
            object: "whatsapp_business_account",
            entry: [
              {
                id: name,
                changes: [
                  {
                    value: {
                      messaging_product: "whatsapp",
                      metadata: {
                        display_phone_number: name,
                        phone_number_id: name
                      },
                      contacts: [
                        {
                          profile: {
                            name: message.pushName || ""
                          },
                          wa_id: wa_id
                        }
                      ],
                      messages: [
                        {
                          from: wa_id,
                          id: message.key.id,
                          timestamp: message.messageTimestamp?.toString() || "",
                          type: "document",
                          document: {
                            mime_type: doc.mimetype,
                            sha256: doc.fileSha256,
                            file_name: doc.fileName,
                            base64: base64String // Envia o arquivo em base64
                          }
                        }
                      ]
                    },
                    field: "messages"
                  }
                ]
              }
            ]
          };

          // Envia o payload para a API de destino
          try {
            //console.log(`Payload: ${JSON.stringify(payload)}`);
            await axios.post(EndPointCRM, payload);
          } catch (err) {
            console.log('Erro ao enviar payload para API:', err.message);
          }
          continue; // já tratou, não precisa cair no else de não mapeada
        }

        // Trata mensagens de áudio separadamente
        if (
          message.message &&
          message.message.audioMessage &&
          !message.key.remoteJid.includes('newsletter')
        ) {
          // Extrai informações do áudio
          const audio = message.message.audioMessage;
          const wa_id = message.key.remoteJid.split('@')[0];
          const extensao = audio.mimetype.includes('ogg') ? 'ogg' : 'mp3';
          const { pasta, nomeArquivo, caminhoCompleto } = getPastaENomeArquivo(message, extensao, 'audio');

          // Cria a pasta se não existir
          if (!fs.existsSync(pasta)) {
            fs.mkdirSync(pasta, { recursive: true });
          }

          // Baixa o áudio corretamente usando a função do Baileys
          let buffer = null;
          try {
            // downloadMediaMessage retorna um buffer com o conteúdo do áudio já decodificado
            buffer = await downloadMediaMessage(
              message,
              'buffer',
              {},
              { logger: P({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
            );
            fs.writeFileSync(caminhoCompleto, buffer);
            console.log(`Áudio salvo em: ${caminhoCompleto}`);
          } catch (err) {
            console.log('Erro ao baixar/salvar áudio:', err.message);
          }

          // Converte o buffer do áudio para base64
          let base64String = '';
          if (buffer) {
            base64String = `data:${audio.mimetype};base64,${buffer.toString('base64')}`;
          }
          //console.log('\n\n Arquivo de audio: \n\n' , base64String)

          // Monta o payload no formato esperado, enviando o áudio em base64
          const payload = {
            object: "whatsapp_business_account",
            entry: [
              {
                id: name,
                changes: [
                  {
                    value: {
                      messaging_product: "whatsapp",
                      metadata: {
                        display_phone_number: name,
                        phone_number_id: name
                      },
                      contacts: [
                        {
                          profile: {
                            name: message.pushName || ""
                          },
                          wa_id: wa_id
                        }
                      ],
                      messages: [
                        {
                          from: wa_id,
                          id: message.key.id,
                          timestamp: message.messageTimestamp?.toString() || "",
                          type: "audio",
                          audio: {
                            mime_type: audio.mimetype,
                            sha256: audio.fileSha256,
                            voice: audio.ptt || false, // indica se é áudio de voz (push-to-talk)
                            duration: audio.seconds?.toString() || "0", // duração em segundos
                            base64: base64String // Envia o áudio em base64
                          }
                        }
                      ]
                    },
                    field: "messages"
                  }
                ]
              }
            ]
          };

          // Envia o payload para a API de destino
          try {
            //console.log(`Payload: ${JSON.stringify(payload)}`);
            await axios.post(EndPointCRM, payload);
          } catch (err) {
            console.log('Erro ao enviar payload para API:', err.message);
          }
          continue; // já tratou, não precisa cair no else de não mapeada
        }

        // Caso seja mensagem de texto ou outros tipos já tratados
        if (mensagem) {
          // Se for status, salva o texto em arquivo
          if (message.key.remoteJid.includes('status')) {
            const { pasta, nomeArquivo, caminhoCompleto } = getPastaENomeArquivo(message, 'txt', 'texto');
            
            // Cria a pasta se não existir
            if (!fs.existsSync(pasta)) {
              fs.mkdirSync(pasta, { recursive: true });
            }
            
            // Salva o texto em arquivo
            try {
              fs.writeFileSync(caminhoCompleto, mensagem);
              console.log(`Texto de status salvo em: ${caminhoCompleto}`);
            } catch (err) {
              console.log('Erro ao salvar texto de status:', err.message);
            }
          }

          console.log(`📩 Mensagem para sessão : ${name} \nMensagem Filtrada: \n Usuario: ${message.key.remoteJid} \n Nome: ${message.pushName} \n Mensagem: ${mensagem}`);
          // Enviar payload para https://woulz.com.br
          try {
            const wa_id = message.key.remoteJid.split('@')[0];
            const payload = {
              object: "whatsapp_business_account",
              entry: [
                {
                  id: message.key.id,
                  changes: [
                    {
                      value: {
                        messaging_product: "whatsapp",
                        metadata: {
                          display_phone_number: name,
                          phone_number_id: name
                        },
                        contacts: [
                          {
                            profile: {
                              name: message.pushName || ""
                            },
                            wa_id: wa_id
                          }
                        ],
                        messages: [
                          {
                            from: wa_id,
                            id: message.key.id,
                            timestamp: message.messageTimestamp?.toString() || "",
                            text: {
                              body: mensagem
                            },
                            type: "text"
                          }
                        ]
                      },
                      field: "messages"
                    }
                  ]
                }
              ]
            };
            //console.log(`Payload: ${JSON.stringify(payload)}`);
            axios.post(EndPointCRM, payload)
              .then(response => {
                console.log('Resposta da API:', response.status, response.data);
              })
              .catch(err => {
                if (err.response) {
                  console.log('Erro ao enviar payload para API:', err.message, 'Status:', err.response.status, 'Data:', err.response.data);
                } else {
                  console.log('Erro ao enviar payload para API:', err.message);
                }
              });
          } catch (err) {
            console.log('Erro ao montar/enviar payload:', err);
          }
        } else if (message.key.fromMe === true) {
          // Mensagem enviada por mim
          console.log(`🆕Enviado por mim:\n📩 Mensagem para sessão : ${name} \nMensagem Filtrada: \n Usuario: ${message.key.remoteJid} \n Nome: ${message.pushName} \n Mensagem: ${mensagem}`);
          console.log(JSON.stringify(message));
        } else {
          // Mensagem não mapeada: salva log para análise futura
          try {
            console.log('🔴 Mensagem não mapeada');
            console.log(JSON.stringify(message));
            // Salva mensagem não tratada em arquivo JSON
            const logPath = './mensagens_nao_tratadas.json';
            let logs = [];
            if (fs.existsSync(logPath)) {
              try {
                const fileContent = fs.readFileSync(logPath, 'utf8');
                logs = JSON.parse(fileContent);
              } catch (e) {
                logs = [];
              }
            }
            logs.push({
              data: new Date().toISOString(),
              sessao: name,
              usuario: message.key.remoteJid,
              nome: message.pushName,
              payload: message
            });
            fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
          } catch {
            console.log('Verificar!');
          }
        }
        //descomentar para debug de formato de mensagem
        //console.log(`📩 Mensagem recebida de: ${JSON.stringify(message)}`);
      }
    } else { // mensagens já lidas
      console.log(`🟢Mensagem Já Lida!🟢`);
      for (const message of messages) {
        //console.log(`🟢 Mensagem para sessão : ${name} \nMensagem Filtrada: \n Usuario: ${message.key.remoteJid} \n Nome: ${message.pushName} \n Mensagem: ${mensagem}`)
      }
    }
  })

  sessions.set(name, sock);
  return sock;
}

export function getSession(name) {
  return sessions.get(name);
}

export function getAllSessions() {
  return Array.from(sessions.keys());
}

export { sessionQRCodes }; // Exporta o cache de QRCode

/**
 * Remove uma sessão completamente: do Map, QRCode, arquivos de autenticação e configuração
 * @param {string} name - Nome da sessão
 * @returns {boolean} - true se removeu, false se não existia
 */
export function deleteSession(name) {
  let removed = false;
  // Marca a sessão para não ser reiniciada
  sessionsToBeDeleted.add(name);
  // Encerra a conexão da sessão, se existir
  const sock = sessions.get(name);
  if (sock && sock.ws && typeof sock.ws.close === 'function') {
    try {
      sock.ws.close();
    } catch (e) {
      console.log('Erro ao encerrar conexão da sessão:', e.message);
    }
  }
  // Remove do Map de sessões
  if (sessions.has(name)) {
    sessions.delete(name);
    removed = true;
  }
  // Remove QRCode em cache
  if (sessionQRCodes.has(name)) {
    sessionQRCodes.delete(name);
  }
  // Remove arquivos de autenticação
  const authDir = `./sessions_data/${name}`;
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
    removed = true;
  }
  // Remove configuração da sessão
  const configPath = path.join('./sessions_config', `${name}.json`);
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
    removed = true;
  }
  // Remove a marcação após um tempo (para evitar bloqueio futuro)
  setTimeout(() => sessionsToBeDeleted.delete(name), 5000);
  return removed;
}