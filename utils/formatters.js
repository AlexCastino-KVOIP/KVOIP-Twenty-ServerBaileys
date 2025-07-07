function formatPhoneNumber(number) {
    // Remove caracteres não numéricos
    number = number.replace(/\D/g, '');
  
    // Adiciona o sufixo do WhatsApp se não tiver
    if (!number.endsWith('@s.whatsapp.net')) {
      number += '@s.whatsapp.net';
    }
  
    return number;
  }
  
  module.exports = {
    formatPhoneNumber
  };
  