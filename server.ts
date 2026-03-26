import express from 'express';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, addDoc } from 'firebase/firestore';
import twilio from 'twilio';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

// Initialize Firebase Client SDK for server-side operations
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory logger for debugging
const serverLogs: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args) => {
  const msg = `[LOG] ${new Date().toISOString()} - ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
  serverLogs.unshift(msg);
  if (serverLogs.length > 100) serverLogs.pop();
  originalConsoleLog(...args);
};

console.error = (...args) => {
  const msg = `[ERR] ${new Date().toISOString()} - ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
  serverLogs.unshift(msg);
  if (serverLogs.length > 100) serverLogs.pop();
  originalConsoleError(...args);
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Simple GET route to verify the webhook is alive
app.get('/api/webhook/twilio', (req, res) => {
  res.status(200).send('Twilio webhook is active and listening for POST requests.');
});

app.get('/api/logs', (req, res) => {
  res.json({ logs: serverLogs });
});

// Initialize Gemini
let ai: GoogleGenAI | null = null;
function getAI() {
  if (!ai) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is missing');
    ai = new GoogleGenAI({ apiKey: key });
  }
  return ai;
}

// Initialize Twilio Client (Lazy load to avoid crash if env vars are missing)
let twilioClient: twilio.Twilio | null = null;
function getTwilioClient() {
  if (!twilioClient) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (sid && token) {
      twilioClient = twilio(sid, token);
    }
  }
  return twilioClient;
}

// Helper to send WhatsApp message using TwiML (works without auth credentials for replies)
async function sendWhatsAppMessage(to: string, body: string, res: express.Response) {
  const response = new twilio.twiml.MessagingResponse();
  response.message(body);
  if (!res.headersSent) {
    res.type('text/xml').send(response.toString());
  }
}

// Twilio Webhook
app.post('/api/webhook/twilio', async (req, res) => {
  console.log('🔔 Received Webhook from Twilio!');
  console.log('Body:', req.body);
  
  const incomingMsg = req.body.Body;
  const from = req.body.From; // e.g., 'whatsapp:+14155238886'

  try {
    // 1. Find user by WhatsApp number using the mappings collection
    const mappingDoc = await getDoc(doc(db, 'whatsapp_mappings', from));
    
    if (!mappingDoc.exists()) {
      await sendWhatsAppMessage(from, `Welcome to Money Manager! Please register your WhatsApp number (${from}) on the dashboard first.`, res);
      return;
    }

    const userId = mappingDoc.data().userId;

    // 2. Process message with Gemini
    const aiClient = getAI();
    const geminiResponse = await aiClient.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Parse this financial transaction: "${incomingMsg}". Return JSON with amount (number), currency (string, e.g. USD), category (string), description (string), type (string: 'expense' or 'income').`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            amount: { type: Type.NUMBER },
            currency: { type: Type.STRING },
            category: { type: Type.STRING },
            description: { type: Type.STRING },
            type: { type: Type.STRING }
          },
          required: ['amount', 'currency', 'category', 'description', 'type']
        }
      }
    });

    const parsedData = JSON.parse(geminiResponse.text || '{}');
    
    // 3. Save to Firestore with a webhook secret to bypass rules
    const transaction = {
      userId,
      amount: parsedData.amount,
      currency: parsedData.currency,
      category: parsedData.category,
      description: parsedData.description,
      type: parsedData.type,
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      webhookSecret: "ai-studio-webhook-secret-2026"
    };

    await addDoc(collection(db, 'transactions'), transaction);

    // 4. Send confirmation back
    await sendWhatsAppMessage(from, `✅ Recorded ${parsedData.type}: ${parsedData.amount} ${parsedData.currency} for ${parsedData.category} (${parsedData.description})`, res);

  } catch (error) {
    console.error('Error processing webhook:', error);
    if (!res.headersSent) {
      await sendWhatsAppMessage(from, 'Sorry, I had trouble processing that. Please try again.', res);
    }
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Only start the server if we are NOT running in a serverless environment like Vercel
if (process.env.VERCEL !== '1') {
  startServer();
}

export default app;
