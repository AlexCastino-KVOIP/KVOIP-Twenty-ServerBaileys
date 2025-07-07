import fs from 'fs';
import path from 'path';

// Diretório onde as configurações das sessões serão salvas
const configDir = './sessions_config';

// Garante que o diretório existe
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

/**
 * Salva a configuração de uma sessão (webhook, workspaceID, canalID)
 * @param {string} sessionName - Nome da sessão
 * @param {object} config - Objeto de configuração
 */
export function saveSessionConfig(sessionName, config) {
  fs.writeFileSync(
    path.join(configDir, `${sessionName}.json`),
    JSON.stringify(config, null, 2)
  );
}

/**
 * Recupera a configuração de uma sessão
 * @param {string} sessionName - Nome da sessão
 * @returns {object|null} - Objeto de configuração ou null se não existir
 */
export function getSessionConfig(sessionName) {
  const filePath = path.join(configDir, `${sessionName}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
} 