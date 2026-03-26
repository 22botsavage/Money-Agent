import React, { useEffect, useState } from 'react';
import { auth, db, signInWithEmail, signUpWithEmail, logOut } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { format } from 'date-fns';
import { Wallet, ArrowUpCircle, ArrowDownCircle, LogOut, MessageCircle } from 'lucide-react';

interface Transaction {
  id: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  type: 'expense' | 'income';
  date: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Auth Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDoc.exists() && userDoc.data().whatsappNumber) {
            setIsRegistered(true);
            const num = userDoc.data().whatsappNumber;
            setWhatsappNumber(num);
            
            // Ensure mapping exists for previously registered users
            try {
              await setDoc(doc(db, 'whatsapp_mappings', num), {
                userId: currentUser.uid
              }, { merge: true });
            } catch (e) {
              console.error("Failed to sync mapping", e);
            }
          } else {
            setIsRegistered(false);
          }
        } catch (error) {
          console.error("Error fetching user:", error);
        }
      }
      setIsAuthReady(true);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthReady && user && isRegistered) {
      const q = query(
        collection(db, 'transactions'),
        where('userId', '==', user.uid),
        orderBy('date', 'desc')
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const txs: Transaction[] = [];
        snapshot.forEach((doc) => {
          txs.push({ id: doc.id, ...doc.data() } as Transaction);
        });
        setTransactions(txs);
      }, (error) => {
        console.error("Error fetching transactions:", error);
      });

      return () => unsubscribe();
    }
  }, [isAuthReady, user, isRegistered]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !whatsappNumber) return;
    
    // Format number to ensure it starts with whatsapp:
    const formattedNumber = whatsappNumber.startsWith('whatsapp:') 
      ? whatsappNumber 
      : `whatsapp:${whatsappNumber.startsWith('+') ? whatsappNumber : '+' + whatsappNumber}`;

    try {
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: user.email,
        whatsappNumber: formattedNumber,
        createdAt: new Date().toISOString()
      }, { merge: true });
      
      // Save mapping for the webhook to use
      await setDoc(doc(db, 'whatsapp_mappings', formattedNumber), {
        userId: user.uid
      });
      
      setIsRegistered(true);
      setWhatsappNumber(formattedNumber);
    } catch (error) {
      console.error("Error registering number:", error);
      alert("Failed to register number. Please try again.");
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      setAuthError(err.message || "Authentication failed.");
    }
  };

  if (!isAuthReady || loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-100">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 p-4">
        <div className="max-w-md w-full bg-gray-900 rounded-2xl shadow-xl border border-gray-800 p-8">
          <div className="w-16 h-16 bg-green-900/30 text-green-400 rounded-full flex items-center justify-center mx-auto mb-6">
            <Wallet size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-100 mb-2 text-center">Money Manager</h1>
          <p className="text-gray-400 mb-8 text-center">Sign in to manage your finances via WhatsApp</p>
          
          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-gray-100 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-gray-100 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all"
                required
              />
            </div>
            {authError && <p className="text-red-400 text-sm text-center">{authError}</p>}
            <button 
              type="submit"
              className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-xl transition-colors"
            >
              {isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>
          
          <p className="text-center text-gray-400 mt-6 text-sm">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button onClick={() => setIsSignUp(!isSignUp)} className="text-green-500 hover:text-green-400 font-medium">
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (!isRegistered) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 p-4">
        <div className="max-w-md w-full bg-gray-900 rounded-2xl shadow-xl border border-gray-800 p-8">
          <h2 className="text-2xl font-bold text-gray-100 mb-2">Connect WhatsApp</h2>
          <p className="text-gray-400 mb-6">Enter your WhatsApp number to link it with your account. Include the country code (e.g., +1234567890).</p>
          
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">WhatsApp Number</label>
              <input 
                type="text" 
                placeholder="+1234567890"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-gray-100 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all placeholder-gray-500"
                required
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-xl transition-colors"
            >
              Connect Number
            </button>
          </form>
          <button onClick={logOut} className="mt-4 text-sm text-gray-400 hover:text-gray-300 w-full text-center">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const totalIncome = transactions.filter(t => t.type === 'income').reduce((acc, curr) => acc + curr.amount, 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((acc, curr) => acc + curr.amount, 0);
  const balance = totalIncome - totalExpense;

  return (
    <div className="min-h-screen bg-gray-950">
      <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <Wallet className="text-green-500" />
              <span className="font-bold text-xl text-gray-100">Money Manager</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-400 hidden sm:block">{user.email}</span>
              <button 
                onClick={logOut}
                className="text-gray-400 hover:text-gray-100 flex items-center gap-1 text-sm font-medium"
              >
                <LogOut size={16} />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Setup Instructions */}
        <div className="bg-blue-950/50 border border-blue-900 rounded-2xl p-6 mb-8 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div>
            <h3 className="text-blue-100 font-semibold flex items-center gap-2 mb-1">
              <MessageCircle size={18} className="text-blue-400" />
              Ready to track!
            </h3>
            <p className="text-blue-300 text-sm">
              Your number <strong className="text-blue-100">{whatsappNumber}</strong> is connected. 
              To record a transaction, send a WhatsApp message to your Twilio Sandbox number.
            </p>
            <p className="text-blue-300 text-sm mt-1">
              Example: <em className="text-blue-200">"I just spent Rp 50.000 on lunch"</em> or <em className="text-blue-200">"Got paid Rp 2.000.000 for freelance work"</em>
            </p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-800">
            <p className="text-sm font-medium text-gray-400 mb-1">Total Balance</p>
            <h3 className={`text-3xl font-bold ${balance >= 0 ? 'text-gray-100' : 'text-red-400'}`}>
              Rp {balance.toLocaleString('id-ID')}
            </h3>
          </div>
          <div className="bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-800">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-400">Income</p>
              <ArrowUpCircle className="text-green-500" size={20} />
            </div>
            <h3 className="text-2xl font-bold text-gray-100">Rp {totalIncome.toLocaleString('id-ID')}</h3>
          </div>
          <div className="bg-gray-900 rounded-2xl p-6 shadow-sm border border-gray-800">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-400">Expenses</p>
              <ArrowDownCircle className="text-red-500" size={20} />
            </div>
            <h3 className="text-2xl font-bold text-gray-100">Rp {totalExpense.toLocaleString('id-ID')}</h3>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="bg-gray-900 rounded-2xl shadow-sm border border-gray-800 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-800">
            <h3 className="text-lg font-semibold text-gray-100">Recent Transactions</h3>
          </div>
          
          {transactions.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              No transactions yet. Send a message on WhatsApp to get started!
            </div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {transactions.map((tx) => (
                <li key={tx.id} className="px-6 py-4 hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        tx.type === 'income' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
                      }`}>
                        {tx.type === 'income' ? <ArrowUpCircle size={20} /> : <ArrowDownCircle size={20} />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-100">{tx.category}</p>
                        <p className="text-xs text-gray-400">{tx.description}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${
                        tx.type === 'income' ? 'text-green-400' : 'text-gray-100'
                      }`}>
                        {tx.type === 'income' ? '+' : '-'}Rp {tx.amount.toLocaleString('id-ID')}
                      </p>
                      <p className="text-xs text-gray-400">
                        {format(new Date(tx.date), 'MMM d, h:mm a')}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
