import express from 'express';
import bodyParser from 'body-parser';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const { Client, LocalAuth } = pkg;

const app = express();
const PORT = 3000;
const ADMIN_NUMBER = '1234567890@c.us';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CLIENT_EMAIL = process.env.CLIENT_EMAIL;

// Startup logging
console.log('='.repeat(50));
console.log('🤖 WordPress WhatsApp Bot Starting...');
console.log('='.repeat(50));
console.log('Node Version:', process.version);
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Port:', PORT);

// Validate environment variables
console.log('\n📋 Environment Variables:');
console.log('RESEND_API_KEY:', RESEND_API_KEY ? '✅ Set' : '❌ Missing');
console.log('CLIENT_EMAIL:', CLIENT_EMAIL ? '✅ Set' : '❌ Missing');
console.log('PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH || 'Not set (will use default)');

if (!RESEND_API_KEY || !CLIENT_EMAIL) {
  console.error('\n⚠️  WARNING: Missing environment variables!');
  console.error('Please set environment variables in Coolify dashboard or .env file');
  console.error('The bot will start but email notifications may not work.\n');
}

const pendingConfirmations = new Map();
const confirmationsSent = new Set(); // Track users who have received confirmation options
const completedSelections = new Set(); // Track users who have completed their selection (1 or 2) and should not receive further responses  

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Puppeteer configuration - different for local vs production
const puppeteerConfig = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-gpu'
  ]
};

// Only set executablePath if explicitly provided (production)
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: puppeteerConfig,
  // No limits on QR code generation
  qrMaxRetries: 0, // 0 = unlimited QR retries
  authTimeoutMs: 0, // 0 = no authentication timeout
  qrTimeoutMs: 0 // 0 = no QR timeout (will keep generating QR codes indefinitely)
});

let isClientReady = false;
let initializationComplete = false;
const startTime = Date.now();

client.on('qr', (qr) => {
  console.log('📱 QR Code received - scan with WhatsApp to authenticate');
  qrcode.generate(qr, { small: true });
});

client.on('disconnected', (reason) => {
  console.log('WhatsApp disconnected:', reason);
  isClientReady = false;
});

client.on('message', async (msg) => {
  try {
    if (msg.fromMe) return;

    const messageBody = msg.body
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, ""); 

    const senderId = msg.from;

    console.log("Incoming message:", messageBody);

    // Ignore messages from users who have completed their selection
    if (completedSelections.has(senderId)) {
      console.log(`⏭️ Ignoring message from ${senderId} - user has completed selection`);
      return;
    }

    // Ignore bot's own automated messages
    if (messageBody.includes('voici un resume de vos informations') || 
        messageBody.includes('veuillez confirmer vos informations') ||
        messageBody.includes('parfait ! voici votre lien de paiement')) {
      return;
    }

    const pendingData = pendingConfirmations.get(senderId);
    if (!pendingData) {
      console.log(`⏭️ Ignoring message from ${senderId} - no pending confirmation`);
      return;
    }

    if (messageBody === '1') {
      const paymentMessage = `🎉 *Parfait !* Voici votre lien de paiement sécurisé :\n\n💳 ${pendingData.paymentLink}\n\nMerci pour votre confiance ! 🙏`;
      await msg.reply(paymentMessage);
      pendingConfirmations.delete(senderId);
      console.log(`✅ Deleted pendingConfirmations for ${senderId} after user chose option 1`);
      confirmationsSent.delete(senderId); // Clean up tracking
      completedSelections.add(senderId); // Mark user as completed - bot will stop responding
      console.log(`🛑 Added ${senderId} to completedSelections - bot will no longer respond`);
      return;
    } 
    if (messageBody === '2') {
      await msg.reply('💬 Bien sûr ! Posez votre question et notre équipe de support vous assistera rapidement. \n\n🤝 Nous sommes là pour vous aider !');
      pendingConfirmations.delete(senderId);
      console.log('Deleted pendingConfirmations for', senderId, 'after user chose option 2');
      confirmationsSent.delete(senderId); // Clean up tracking
      completedSelections.add(senderId); // Mark user as completed - bot will stop responding
      console.log(`🛑 Added ${senderId} to completedSelections - bot will no longer respond`);
      return;
    }
    const confirmKeywords = [
      'valide','c bon','cv','ca marche',"lets go",'ok je confirme','on y va','pas de probleme','proceed','continue','avance','suivant','step 2',
      'payer','go paiement','envoyer lien','je veux payer','pret','ready','approved','confirme','link please','payment ok','jaccepte',
      'je suis daccord','continuez','processus ok','je suis pret','je valide','all good','no problem','ca me va','oui','yes','ok','okay',
      'cest bon','je confirme','daccord','parfait','go','envoyez','envoyez le lien','lien paiement','payment link','send link','secure link',
      'lets go','proceed','ready','confirm','send'
    ];

    const modifyKeywords = [
      'changer','modifier','pas correct','incorrect','refaire','je veux corriger','changer email','changer numero','je veux recommencer',
      'je veux refaire','reverifier','pas bon','mauvais','wrong info','bad info','not correct','edit info','update details','error','mistake',
      'correction','new info','changer nom','changer plan','changer offre','changer option','reprendre','retour au debut','non','modifier',
      'corriger','erreur','jai fait une erreur','je veux changer','mettre a jour','update','changer info','modifier info','refaire',
      'retour','back','edit','wrong','incorrect','restart','resend form'
    ];

    const questionKeywords = [
      'avant','info svp','svp question','besoin plus d infos','expliquez','comment ca marche','details','plus de details','je ne comprends pas',
      'clarifiez','clarification','explication','vous pouvez maider','support svp','service client','contact','sav','comment payer','c est securise',
      'pose question','i have a question','need help','not clear','more info','tell me more','unclear','before i pay','before i continue','question',
      'jai une question','besoin daide','aide','support','plus dinformations','info','comment','pourquoi','je veux savoir','avant dacheter',
      'avant de payer','je veux comprendre','expliquer','clarification','help','support','ask'
    ];

    const includesKeyword = (keywords) => 
      keywords.some(keyword => messageBody.includes(keyword));

    if (includesKeyword(confirmKeywords)) {
      const paymentMessage = `🎉 *Parfait !* Voici votre lien de paiement sécurisé :\n\n💳 ${pendingData.paymentLink}\n\nMerci pour votre confiance ! 🙏`;
      await msg.reply(paymentMessage);
      pendingConfirmations.delete(senderId);
      confirmationsSent.delete(senderId); // Clean up tracking
      completedSelections.add(senderId); // Mark user as completed - bot will stop responding
      console.log(`🛑 Added ${senderId} to completedSelections - bot will no longer respond`);
      return;
    }

    if (includesKeyword(questionKeywords)) {
      await msg.reply('💬 Bien sûr ! Posez votre question et notre équipe de support vous assistera rapidement. \n\n🤝 Nous sommes là pour vous aider !');
      pendingConfirmations.delete(senderId);
      confirmationsSent.delete(senderId); // Clean up tracking
      completedSelections.add(senderId); // Mark user as completed - bot will stop responding
      console.log(`🛑 Added ${senderId} to completedSelections - bot will no longer respond`);
      return;
    }

    // Only show fallback if user has already received confirmation options
    if (confirmationsSent.has(senderId)) {
      await msg.reply('⚠️ Je n\'ai pas bien compris votre réponse. Tapez *1* ou *2* pour continuer.');
    }

  } catch (error) {
    console.error('Error handling message:', error);
  }
});

// Add more event listeners for debugging
client.on('loading_screen', (percent, message) => {
  console.log('LOADING:', percent, message);
});

client.on('change_state', state => {
  console.log('STATE CHANGED:', state);
});

// Initialize WhatsApp client with error handling and timeout
console.log('Starting WhatsApp client initialization...');
console.log('Chromium path:', process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium');

// Add initialization timeout (2 minutes)
const INIT_TIMEOUT = 120000;

const initializationTimeout = setTimeout(() => {
  if (!isClientReady && !initializationComplete) {
    console.error('\n⏰ WhatsApp client initialization timeout!');
    console.error('The client has been stuck for more than 2 minutes.');
    console.error('Please check the logs and restart manually if needed.');
  }
}, INIT_TIMEOUT);

client.on('ready', () => {
  initializationComplete = true;
  clearTimeout(initializationTimeout);
  console.log('✅ WhatsApp bot is ready!');
  isClientReady = true;
});

client.on('authenticated', () => {
  console.log('✅ WhatsApp authenticated successfully');
  console.log('Loading WhatsApp Web interface...');
});

client.on('auth_failure', (msg) => {
  initializationComplete = true;
  clearTimeout(initializationTimeout);
  console.error('❌ Authentication failure:', msg);
  console.error('Clearing auth cache and restarting...');
  process.exit(1);
});

client.initialize()
  .then(() => {
    console.log('WhatsApp client initialization started successfully');
    console.log('Waiting for authentication...');
  })
  .catch(err => {
    initializationComplete = true;
    clearTimeout(initializationTimeout);
    console.error('❌ Failed to initialize WhatsApp client:', err);
    console.error('Error stack:', err.stack);
    console.error('\nThis might be due to:');
    console.error('1. Missing Chrome/Chromium installation');
    console.error('2. Insufficient system resources');
    console.error('3. Network connectivity issues');
    console.error('4. Incorrect Chromium path');

    // Don't exit immediately, let's see if we can get more info
    setTimeout(() => {
      console.error('Exiting due to initialization failure...');
      process.exit(1);
    }, 5000);
  });

const getPaymentLink = (offer, connections) => {
  const offerLower = (offer || '').toLowerCase();
const conn = parseInt(connections) ? parseInt(connections).toString() : '1';
  
  const paymentLinks = {
    '12 mois': {
      '1': 'https://abonnementpremium.com/index.php/step/premium/?add-to-cart=1127',
      '2': 'https://abonnementpremium.com/index.php/step/premium-2/?add-to-cart=1720',
      '3': 'https://abonnementpremium.com/index.php/step/premium-3/?add-to-cart=1721'
    },
    '6 mois': {
      '1': 'https://abonnementpremium.com/index.php/step/gold/?add-to-cart=1126',
      '2': 'https://abonnementpremium.com/index.php/step/gold-2/?add-to-cart=1722',
      '3': 'https://abonnementpremium.com/index.php/step/gold-3/?add-to-cart=1723'
    },
    '3 mois': {
      '1': 'https://abonnementpremium.com/index.php/step/standard/?add-to-cart=1125',
      '2': 'https://abonnementpremium.com/index.php/step/standard-2/?add-to-cart=1724',
      '3': 'https://abonnementpremium.com/index.php/step/standard-3/?add-to-cart=1725'
    },
    '1 mois': {
      '1': 'https://abonnementpremium.com/index.php/step/basic/?add-to-cart=1097',
      '2': 'https://abonnementpremium.com/index.php/step/basic-2/?add-to-cart=1726',
      '3': 'https://abonnementpremium.com/index.php/step/basic-3/?add-to-cart=1727'
    },
    'test': {
      '1': 'https://abonnementpremium.com/index.php/step/test/?add-to-cart=1128',
      '2': 'https://abonnementpremium.com/index.php/step/test-2/?add-to-cart=1728',
      '3': 'https://abonnementpremium.com/index.php/step/test-3/?add-to-cart=1729'
    }
  };

  for (const [key, links] of Object.entries(paymentLinks)) {
    if (offerLower.includes(key.toLowerCase()) || offerLower.includes(key.replace(' ', ''))) {
      return links[conn] || links['1'];
    }
  }

  return paymentLinks['test']['1'];
};

const getPricing = (offer, connections) => {
  const offerLower = (offer || '').toLowerCase();
  const conn = parseInt(connections) || 1;
  
  const pricing = {
    '12 mois': {
      1: 59.99,
      2: 95.99,
      3: 120.99
    },
    '6 mois': {
      1: 45.99,
      2: 75.99,
      3: 99.99
    },
    '3 mois': {
      1: 29.99,
      2: 49.99,
      3: 69.99
    },
    '1 mois': {
      1: 15.99,
      2: 25.99,
      3: 39.99
    },
    'test': {
      1: 2.99,
      2: 4.99,
      3: 6.99
    }
  };

  for (const [key, prices] of Object.entries(pricing)) {
    if (offerLower.includes(key.toLowerCase()) || offerLower.includes(key.replace(' ', ''))) {
      return prices[conn] || prices[1];
    }
  }

  return 0;
};

const sendEmailNotification = async (formData) => {
  try {
    const { name, email, phone, offer, connections, page_url, price } = formData;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
          .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-radius: 0 0 5px 5px; }
          .field { margin-bottom: 15px; padding: 10px; background-color: white; border-left: 4px solid #4CAF50; }
          .field-label { font-weight: bold; color: #4CAF50; }
          .field-value { margin-top: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>🔔 Nouvelle demande d'abonnement</h2>
          </div>
          <div class="content">
            <div class="field">
              <div class="field-label">👤 Nom:</div>
              <div class="field-value">${name || 'Non spécifié'}</div>
            </div>
            <div class="field">
              <div class="field-label">📧 Email:</div>
              <div class="field-value">${email || 'Non spécifié'}</div>
            </div>
            <div class="field">
              <div class="field-label">📱 Numéro WhatsApp:</div>
              <div class="field-value">${phone || 'Non spécifié'}</div>
            </div>
            <div class="field">
              <div class="field-label">📦 Offre:</div>
              <div class="field-value">${offer || 'Non spécifié'}</div>
            </div>
            <div class="field">
              <div class="field-label">🔗 Connexions:</div>
              <div class="field-value">${connections || 'Non spécifié'}</div>
            </div>
            <div class="field">
              <div class="field-label">💰 Prix:</div>
              <div class="field-value">${price}€</div>
            </div>
            <div class="field">
              <div class="field-label">🌐 Page URL:</div>
              <div class="field-value">${page_url || 'Non spécifié'}</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const response = await axios.post(
      'https://api.resend.com/emails',
      {
        from: 'Abonnement Premium <onboarding@resend.dev>',
        to: [CLIENT_EMAIL],
        subject: 'Nouvelle demande d\'abonnement',
        html: htmlContent
      },
      {
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Email sent successfully via Resend');
    return { success: true, data: response.data };
  } catch (error) {
    console.error('❌ Error sending email via Resend:', error.response?.data || error.message);
    return { success: false, error: error.response?.data || error.message };
  }
};

app.post('/api/form-data', async (req, res) => {
  console.log('\n' + '='.repeat(50));
  console.log('📥 Received webhook request');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  console.log('='.repeat(50));

  try {
    const { name, phone, email, offer, connections, page_url } = req.body;

    if (!isClientReady) {
      console.error('❌ WhatsApp client not ready');
      return res.status(503).json({ 
        success: false, 
        message: 'WhatsApp bot is not ready yet' 
      });
    }

    if (!phone) {
      console.error('❌ Missing phone number');
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required' 
      });
    }

    console.log('✅ Validation passed, processing order...');

    const userName = name || 'Client';
    const userEmail = email || 'Non fourni';
    const userOffer = offer || 'Non spécifié';
    const userConnections = connections || '1';
    const pageUrl = page_url || 'Non fourni';

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const userWhatsAppId = cleanPhone.includes('@c.us') ? cleanPhone : `${cleanPhone}@c.us`;

    pendingConfirmations.delete(userWhatsAppId);
    confirmationsSent.delete(userWhatsAppId);
    completedSelections.delete(userWhatsAppId);

    const paymentLink = getPaymentLink(offer, connections);
    const price = getPricing(offer, connections);
    const userMessage = `Salut 👋 *${userName}*, merci pour votre demande d'abonnement ✅\n\nVoici un résumé de vos informations :\n\n📦 Pack choisi : *${userOffer}*\n🔗 Connexions : *${userConnections}*\n\n💰 Prix total : *${price}€*`;
    const confirmationMessage = `✅ *Veuillez confirmer vos informations :*\n\n1️⃣ Oui, je confirme mes informations. *Envoyez-moi le lien de paiement sécurisé* 💳\n\n2️⃣ J'ai une question avant de m'abonner\n\n👆 Répondez avec le numéro ou le texte correspondant.`;

    const adminMessage = `🔔 *Nouvelle inscription*

👤 *Nom:* ${userName}
📱 *WhatsApp:* ${phone}
📧 *Email:* ${userEmail}
📦 *Offre:* ${userOffer}
🔗 *Connexions:* ${userConnections}
🌐 *Page:* ${pageUrl}`;

    pendingConfirmations.set(userWhatsAppId, { paymentLink, price });
    console.log(`💾 Stored pending confirmation for ${userWhatsAppId}`);
    
    console.log(`📤 Sending summary message to ${userWhatsAppId}...`);
    await client.sendMessage(userWhatsAppId, userMessage);
    console.log('✅ Summary message sent');
    
    await new Promise(resolve => setTimeout(resolve, 1000)); 
    
    console.log(`📤 Sending confirmation options to ${userWhatsAppId}...`);
    await client.sendMessage(userWhatsAppId, confirmationMessage);
    confirmationsSent.add(userWhatsAppId); // Mark that user has received options
    console.log('✅ Confirmation options sent');

    const FORWARD_NUMBER = '212628468203@c.us'; 
    const forwardMessage = `Nouvelle Commande ✅✅ :\n\nNumero whatsapp: ${phone}\nNom complet : ${userName}\nPack : ${userOffer}\n\nNuméro cnx: ${userConnections}\nGmail: ${userEmail}\nPrix: ${price}€`;

    console.log(`📤 Forwarding order to admin ${FORWARD_NUMBER}...`);
    await client.sendMessage(FORWARD_NUMBER, forwardMessage);
    console.log('✅ Order forwarded to admin');

    const emailResult = await sendEmailNotification({
      name: userName,
      email: userEmail,
      phone: phone,
      offer: userOffer,
      connections: userConnections,
      page_url: pageUrl,
      price: price
    });

    res.json({ 
      success: true, 
      message: 'Messages sent successfully',
      emailSent: emailResult.success
    });

  } catch (error) {
    console.error('Error processing form data:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send messages',
      error: error.message 
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'WordPress WhatsApp Bot',
    status: 'running',
    whatsappReady: isClientReady,
    endpoints: {
      webhook: '/api/form-data',
      health: '/health',
      test: '/test'
    }
  });
});

app.get('/health', (req, res) => {
  const uptime = Date.now() - startTime;
  const uptimeSeconds = Math.floor(uptime / 1000);

  // If not ready after 2 minutes, consider unhealthy
  const isHealthy = isClientReady || uptimeSeconds < 120;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    whatsappReady: isClientReady,
    initializationComplete: initializationComplete,
    uptimeSeconds: uptimeSeconds,
    timestamp: new Date().toISOString()
  });
});

app.get('/test', (req, res) => {
  console.log('🧪 Test endpoint accessed');
  res.json({
    message: 'Bot is accessible!',
    whatsappReady: isClientReady,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📡 Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log('='.repeat(50));
  console.log('\n⏳ Waiting for WhatsApp client to initialize...\n');
});
