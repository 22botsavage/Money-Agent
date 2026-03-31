import express from 'express';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import twilio from 'twilio';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import { format } from 'date-fns';

// Initialize Firebase Client SDK for server-side operations
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(firebaseApp);

let isAdminAuthenticated = false;
async function ensureAdminAuth() {
  if (!isAdminAuthenticated) {
    try {
      await signInWithEmailAndPassword(auth, 'super-admin@admin.com', 'Admin12345');
      isAdminAuthenticated = true;
      console.log('✅ Server authenticated as super-admin');
    } catch (error: any) {
      if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        try {
          await createUserWithEmailAndPassword(auth, 'super-admin@admin.com', 'Admin12345');
          isAdminAuthenticated = true;
          console.log('✅ Server created and authenticated as super-admin');
        } catch (createError) {
          console.error('❌ Failed to create super-admin:', createError);
        }
      } else {
        console.error('❌ Failed to authenticate server as super-admin:', error);
      }
    }
  }
}

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
async function sendWhatsAppMessage(to: string, body: string, res: express.Response, fromNumber: string = 'whatsapp:+14155238886') {
  const client = getTwilioClient();
  
  if (client) {
    try {
      // Use REST API to send message (more reliable, avoids 15s webhook timeout drops)
      await client.messages.create({
        from: fromNumber, // Twilio Sandbox Number
        to: to,
        body: body
      });
      console.log('✅ Sent WhatsApp message via REST API');
      if (!res.headersSent) {
        res.status(200).send('<Response></Response>'); // Empty TwiML to acknowledge
      }
      return;
    } catch (error) {
      console.error('❌ Failed to send via REST API, falling back to TwiML:', error);
    }
  }

  // Fallback to TwiML
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
    // 0. Ensure server is authenticated as admin to read Firestore data
    await ensureAdminAuth();

    // 1. Find user by WhatsApp number using the mappings collection
    const mappingDoc = await getDoc(doc(db, 'whatsapp_mappings', from));
    
    if (!mappingDoc.exists()) {
      await sendWhatsAppMessage(from, `Welcome to Money Manager! Please register your WhatsApp number (${from}) on the dashboard first.`, res, req.body.To);
      return;
    }

    const userId = mappingDoc.data().userId;

    // 2. Process message with Gemini (Text or Audio)
    const aiClient = getAI();
    let contentsParts: any[] = [];

    if (req.body.NumMedia && parseInt(req.body.NumMedia) > 0) {
      // Handle Voice Message / Audio
      const mediaUrl = req.body.MediaUrl0;
      const mimeType = req.body.MediaContentType0;
      
      console.log(`🎤 Received media: ${mimeType} from ${mediaUrl}`);
      
      // Download the audio file from Twilio
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const headers: Record<string, string> = {};
      
      if (sid && token) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
      }

      const mediaResponse = await fetch(mediaUrl, { headers });
      
      if (!mediaResponse.ok) {
        console.error(`Failed to fetch media: ${mediaResponse.status} ${mediaResponse.statusText}`);
        throw new Error('Failed to download voice message from Twilio.');
      }
      
      const arrayBuffer = await mediaResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Data = buffer.toString('base64');

      contentsParts.push({
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      });
      contentsParts.push({ 
        text: `Listen to this voice message and parse the financial transaction. Return JSON with amount (number), currency (string, default to IDR), category (string), description (string), type (string: 'expense', 'income', or 'none'). If it's not a transaction, set type to 'none' and amount to 0.` 
      });
    } else {
      // Handle Text Message
      contentsParts.push({ 
        text: `Parse this financial transaction: "${incomingMsg}". Return JSON with amount (number), currency (string, default to IDR), category (string), description (string), type (string: 'expense', 'income', or 'none'). If it's not a transaction (e.g., asking for a recap, greeting, or reset), set type to 'none' and amount to 0.` 
      });
    }

    const geminiResponse = await aiClient.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: contentsParts },
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
    if (parsedData.type === 'expense' || parsedData.type === 'income') {
      const transaction = {
        userId,
        amount: parsedData.amount || 0,
        currency: parsedData.currency || 'IDR',
        category: parsedData.category || 'Uncategorized',
        description: parsedData.description || 'Transaction',
        type: parsedData.type,
        date: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        webhookSecret: "ai-studio-webhook-secret-2026"
      };

      await addDoc(collection(db, 'transactions'), transaction);
    }

    // 4. Fetch data for Daily Finan-Check
    const userDoc = await getDoc(doc(db, 'users', userId));
    const userEmail = userDoc.exists() ? userDoc.data().email : 'User';

    const txQuery = query(collection(db, 'transactions'), where('userId', '==', userId));
    const txSnapshot = await getDocs(txQuery);
    
    let totalIncome = 0;
    let totalExpense = 0;
    
    let todayIncome = 0;
    let todayExpense = 0;
    let biggestExpenseAmount = 0;
    let biggestExpenseName = '-';

    const now = new Date();
    
    // Format date specifically for Indonesia timezone (WIB)
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now); // Returns YYYY-MM-DD

    const displayDate = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(now);

    txSnapshot.forEach(docSnap => {
      const tx = docSnap.data();
      const amount = tx.amount || 0;
      
      if (tx.type === 'income') totalIncome += amount;
      else if (tx.type === 'expense') totalExpense += amount;

      if (tx.date) {
        try {
          // Convert transaction UTC date to WIB string for accurate comparison
          const txDateWib = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date(tx.date));

          if (txDateWib === todayStr) {
            if (tx.type === 'income') {
              todayIncome += amount;
            } else if (tx.type === 'expense') {
              todayExpense += amount;
              if (amount > biggestExpenseAmount) {
                biggestExpenseAmount = amount;
                biggestExpenseName = tx.category || tx.description;
              }
            }
          }
        } catch (e) {
          console.error('Invalid date format in transaction:', tx.date);
        }
      }
    });

    const totalBalance = totalIncome - totalExpense;
    const dailyBudget = 150000; // Default daily budget
    const budgetLeft = dailyBudget - todayExpense;

    const formatIdr = (num: number) => `Rp ${num.toLocaleString('id-ID')}`;

    const replyMessage = `📉 DAILY FINAN-CHECK\n\nUser: ${userEmail}\nDate: ${displayDate}\n\n💰 IN: ${formatIdr(todayIncome)}\n💸 OUT: ${formatIdr(todayExpense)}\n🏦 BALANCE: ${formatIdr(totalBalance)}\n\n⚠️ BUDGET LEFT: ${formatIdr(budgetLeft)}\n🚩 LEAK: ${biggestExpenseName} - ${formatIdr(biggestExpenseAmount)}\n\nThink before you spend.`;

    // 5. Send confirmation back
    await sendWhatsAppMessage(from, replyMessage, res, req.body.To);

  } catch (error) {
    console.error('Error processing webhook:', error);
    if (!res.headersSent) {
      await sendWhatsAppMessage(from, 'Sorry, I had trouble processing that. Please try again.', res, req.body.To);
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
