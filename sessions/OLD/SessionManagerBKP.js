//import makeWASocket , { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { makeWASocket, useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys';
import P from 'pino';
import QRCode from 'qrcode-terminal';
import axios from 'axios';

const sessions = new Map();

export async function createSession(name) {
  if (sessions.has(name)) {
    return sessions.get(name);
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
      console.log(`Session ${name} QR code:`);
      QRCode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log(`Session ${name} connected!`);
    }
    if (connection === 'close') {
      console.log(`Session ${name} disconnected!`);
      // Remove a sessão antiga do Map
      sessions.delete(name);

      // Verifica se o erro exige restart
      const shouldRestart = lastDisconnect?.error?.output?.statusCode !== 401
        || (lastDisconnect?.error?.message && lastDisconnect.error.message.includes('restart required'));

      if (shouldRestart) {
        // Aguarda 2 segundos antes de tentar reconectar
        setTimeout(() => createSession(name), 2000);
      }
    }
  });
  sock.ev.on('messages.upsert', ({ type, messages }) => {
    if (type == "notify") { // new messages
      for (const message of messages) {
        if (message.key.remoteJid.includes('status@broadcast')) {
        }
        if (message.key.remoteJid.includes('@g.us')) {
          try{ console.log(`📩✍️ Mensagem de grupo para sessão: ${name} \nMensagem Filtrada: \n Usuario: ${message.key.remoteJid} \n Nome: ${message.pushName} \n Mensagem: ${message.message.conversation}`)
          }
          catch{
            console.log('Erro ao exibir mensagem:')
            console.log(message)
          }
        }
        let mensagem = null
        if (message.message.conversation !== null || message.message.extendedTextMessage ) {
          if(message.message.extendedTextMessage){
            mensagem = message.message.extendedTextMessage.text
          }
          else{
            mensagem = message.message.conversation
          }
          console.log(`📩 Mensagem para sessão : ${name} \nMensagem Filtrada: \n Usuario: ${message.key.remoteJid} \n Nome: ${message.pushName} \n Mensagem: ${mensagem}`)
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
                              body: message.message.conversation
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
            console.log(`Payload: ${JSON.stringify(payload)}`)
            axios.post('http://crm.kvoip.com.br/whatsapp/webhook/69c6c3a4-f795-4118-91ab-83db863f2716', payload)
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
        }
        else if (message.key.fromMe === true) {
          console.log(`🆕Enviado por mim:\n📩 Mensagem para sessão : ${name} \nMensagem Filtrada: \n Usuario: ${message.key.remoteJid} \n Nome: ${message.pushName} \n Mensagem: ${message.message.conversation}`)
          console.log(JSON.stringify(message))

        }
        else{
          try{
            console.log('🔴 Mensagem não mapeada')
            console.log(JSON.stringify(message))
          }
          catch{
            console.log('Verificar!')
          }

        }
        //descomentar para debug de formato de mensagem
        //console.log(`📩 Mensagem recebida de: ${JSON.stringify(message)}`);
      }
    } else { // old already seen / handled messages
      console.log(`🟢Mensagem Já Lida!🟢`);
      for (const message of messages) {
        //console.log(`🟢 Mensagem para sessão : ${name} \nMensagem Filtrada: \n Usuario: ${message.key.remoteJid} \n Nome: ${message.pushName} \n Mensagem: ${message.message.conversation}`)
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
