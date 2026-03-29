import React, { useEffect, useState, useMemo } from 'react';
import { auth, db, signInWithEmail, signUpWithEmail, logOut } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { format } from 'date-fns';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

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

  // Reset State
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleReset = async () => {
    setIsResetting(true);
    try {
      const deletePromises = transactions.map(tx => deleteDoc(doc(db, 'transactions', tx.id)));
      await Promise.all(deletePromises);
      setIsResetModalOpen(false);
    } catch (error) {
      console.error("Error resetting data:", error);
    } finally {
      setIsResetting(false);
    }
  };

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
    
    try {
      // Format number: ensure it starts with whatsapp:+
      let formattedNum = whatsappNumber.trim();
      if (!formattedNum.startsWith('whatsapp:')) {
        formattedNum = `whatsapp:${formattedNum.startsWith('+') ? formattedNum : '+' + formattedNum}`;
      }

      await setDoc(doc(db, 'users', user.uid), {
        whatsappNumber: formattedNum,
        email: user.email,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      await setDoc(doc(db, 'whatsapp_mappings', formattedNum), {
        userId: user.uid
      });

      setWhatsappNumber(formattedNum);
      setIsRegistered(true);
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
    } catch (error: any) {
      setAuthError(error.message || 'Authentication failed');
    }
  };

  const chartData = useMemo(() => {
    if (transactions.length === 0) return [];

    const dailyData: Record<string, { income: number; expense: number; dateStr: string }> = {};

    transactions.forEach(tx => {
      if (!tx.date) return;
      try {
        const dateObj = new Date(tx.date);
        const dateStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(dateObj);

        if (!dailyData[dateStr]) {
          dailyData[dateStr] = { income: 0, expense: 0, dateStr };
        }
        
        const amount = tx.amount || 0;
        if (tx.type === 'income') {
          dailyData[dateStr].income += amount;
        } else if (tx.type === 'expense') {
          dailyData[dateStr].expense += amount;
        }
      } catch (e) {
        console.error("Invalid date in transaction", tx);
      }
    });

    const sortedDates = Object.keys(dailyData).sort();
    let cumulativeBalance = 0;

    return sortedDates.map(dateStr => {
      const dayData = dailyData[dateStr];
      cumulativeBalance += (dayData.income - dayData.expense);
      
      const displayDate = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jakarta',
        month: 'short',
        day: 'numeric'
      }).format(new Date(dateStr));

      return {
        dateStr,
        displayDate,
        income: dayData.income,
        expense: dayData.expense,
        balance: cumulativeBalance
      };
    });
  }, [transactions]);

  if (!isAuthReady || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface text-primary font-body">
        <div className="animate-pulse flex flex-col items-center">
          <span className="material-symbols-outlined text-4xl mb-2">sync</span>
          <p className="text-sm font-bold font-headline">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-4 font-body text-on-surface">
        <div className="bg-surface-container-lowest p-8 rounded-2xl shadow-xl shadow-emerald-900/5 max-w-md w-full border border-surface-container">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-primary font-headline tracking-tight">Atmospheric Trust</h1>
            <p className="text-xs uppercase tracking-widest text-outline font-medium mt-1">Private Wealth</p>
          </div>
          
          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1 font-label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface-container-low border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-outline-variant"
                placeholder="julian@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1 font-label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface-container-low border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-outline-variant"
                placeholder="••••••••"
                required
              />
            </div>
            
            {authError && (
              <div className="p-3 bg-error-container text-on-error-container rounded-xl text-sm font-medium">
                {authError}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-primary text-white text-sm font-bold rounded-xl shadow-sm hover:shadow-md hover:bg-primary/90 transition-all mt-6"
            >
              {isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-sm text-primary hover:underline font-medium"
            >
              {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isRegistered) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-4 font-body text-on-surface">
        <div className="bg-surface-container-lowest p-8 rounded-2xl shadow-xl shadow-emerald-900/5 max-w-md w-full border border-surface-container">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-3xl">chat</span>
            </div>
            <h1 className="text-2xl font-bold text-primary font-headline tracking-tight">Connect WhatsApp</h1>
            <p className="text-xs text-outline font-medium mt-2">Enter your WhatsApp number to start tracking expenses via chat.</p>
          </div>
          
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1 font-label">WhatsApp Number</label>
              <input
                type="text"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                className="w-full bg-surface-container-low border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-outline-variant"
                placeholder="+6281234567890"
                required
              />
              <p className="text-[10px] text-outline mt-2">Include country code (e.g., +62 for Indonesia)</p>
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-primary text-white text-sm font-bold rounded-xl shadow-sm hover:shadow-md hover:bg-primary/90 transition-all mt-4"
            >
              Connect Number
            </button>
          </form>
        </div>
      </div>
    );
  }

  const totalIncome = transactions.filter(t => t.type === 'income').reduce((acc, curr) => acc + (curr.amount || 0), 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((acc, curr) => acc + (curr.amount || 0), 0);
  const balance = totalIncome - totalExpense;

  return (
    <div className="bg-surface font-body text-on-surface antialiased min-h-screen flex">
      {/* Sidebar Layout */}
      <aside className="h-screen w-64 fixed left-0 top-0 overflow-y-auto bg-emerald-50/50 flex flex-col p-4 space-y-2 z-50 border-r border-surface-container">
        <div className="mb-8 px-4 py-2">
          <h1 className="text-lg font-bold text-primary font-headline tracking-tight">Atmospheric Trust</h1>
          <p className="text-[10px] uppercase tracking-widest text-primary/60 font-medium">Private Wealth</p>
        </div>
        <nav className="flex-1 space-y-1">
          <a className="flex items-center gap-3 px-4 py-3 text-primary font-semibold bg-white rounded-xl shadow-sm transition-transform duration-150 active:scale-95" href="#">
            <span className="material-symbols-outlined">dashboard</span>
            <span className="text-sm font-label font-medium">Dashboard</span>
          </a>
          <a className="flex items-center gap-3 px-4 py-3 text-outline hover:text-primary transition-colors hover:bg-emerald-100/50 rounded-xl" href="#">
            <span className="material-symbols-outlined">payments</span>
            <span className="text-sm font-label font-medium">Payments</span>
          </a>
          <a className="flex items-center gap-3 px-4 py-3 text-outline hover:text-primary transition-colors hover:bg-emerald-100/50 rounded-xl" href="#">
            <span className="material-symbols-outlined">receipt_long</span>
            <span className="text-sm font-label font-medium">Transactions</span>
          </a>
          <a className="flex items-center gap-3 px-4 py-3 text-outline hover:text-primary transition-colors hover:bg-emerald-100/50 rounded-xl" href="#">
            <span className="material-symbols-outlined">trending_up</span>
            <span className="text-sm font-label font-medium">Investments</span>
          </a>
        </nav>
        
        {/* CTA Card */}
        <div className="mt-auto p-4 bg-primary-container rounded-xl text-white relative overflow-hidden group mb-4">
          <div className="absolute -right-4 -top-4 w-16 h-16 bg-white/10 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
          <p className="text-xs font-medium text-primary-fixed mb-1">Portfolio Insight</p>
          <h4 className="text-sm font-bold font-headline mb-3 leading-tight">Ready for a new asset?</h4>
          <button className="w-full py-2 bg-white text-primary text-xs font-bold rounded-full shadow-sm hover:shadow-md transition-shadow">
            New Transaction
          </button>
        </div>

        <div className="pt-4 border-t border-emerald-900/5 space-y-1">
          <a className="flex items-center gap-3 px-4 py-3 text-outline hover:text-primary transition-colors" href="#">
            <span className="material-symbols-outlined">settings</span>
            <span className="text-sm font-label font-medium">Settings</span>
          </a>
          <button onClick={logOut} className="w-full flex items-center gap-3 px-4 py-3 text-outline hover:text-primary transition-colors">
            <span className="material-symbols-outlined">logout</span>
            <span className="text-sm font-label font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Wrapper */}
      <div className="ml-64 mr-[300px] min-h-screen w-full">
        {/* Top Navigation */}
        <header className="fixed top-0 left-64 right-[300px] h-16 z-40 bg-white/80 backdrop-blur-xl shadow-sm shadow-emerald-900/5 flex justify-between items-center px-8">
          <div className="flex items-center w-full max-w-md">
            <div className="relative w-full">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm">search</span>
              <input className="w-full bg-surface-container-low border-none rounded-full pl-10 pr-4 py-2 text-sm focus:ring-1 focus:ring-primary/30 transition-all placeholder:text-outline-variant" placeholder="Search wealth assets, reports..." type="text"/>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <button className="text-outline hover:text-primary transition-colors">
                <span className="material-symbols-outlined">help_outline</span>
              </button>
              <button className="text-outline hover:text-primary transition-colors relative">
                <span className="material-symbols-outlined">notifications</span>
                <span className="absolute top-0 right-0 w-2 h-2 bg-error rounded-full border-2 border-white"></span>
              </button>
            </div>
            <div className="h-8 w-px bg-outline-variant/20 mx-2"></div>
            <div className="flex items-center gap-3 group">
              <div className="text-right hidden xl:block">
                <p className="text-sm font-bold font-headline text-on-surface leading-tight">{user.email?.split('@')[0]}</p>
                <p className="text-[10px] text-outline font-medium">Private Tier Client</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-white font-bold border-2 border-primary/10">
                {user.email?.charAt(0).toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="pt-24 px-8 pb-12 space-y-8">
          {/* Hero Section: Balance & Action Grid */}
          <section className="grid grid-cols-12 gap-6">
            {/* Primary Balance Card */}
            <div className="col-span-8 primary-gradient rounded-xl p-8 text-white relative overflow-hidden shadow-xl shadow-primary/20">
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-primary-fixed/80 text-sm font-medium mb-1">Total Available Wealth</p>
                    <h2 className="text-5xl font-extrabold font-headline tracking-tight">Rp {balance.toLocaleString('id-ID')}</h2>
                  </div>
                  <span className="bg-white/10 backdrop-blur px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">verified</span>
                    Secured Assets
                  </span>
                </div>
                <div className="mt-12 flex items-center gap-8">
                  <div>
                    <p className="text-primary-fixed/60 text-[10px] uppercase font-bold tracking-widest mb-1">Portfolio Yield</p>
                    <p className="text-xl font-bold font-headline">+12.4% <span className="text-sm font-normal opacity-70">y/y</span></p>
                  </div>
                  <div className="w-px h-10 bg-white/20"></div>
                  <div>
                    <p className="text-primary-fixed/60 text-[10px] uppercase font-bold tracking-widest mb-1">Risk Profile</p>
                    <p className="text-xl font-bold font-headline">Conservative</p>
                  </div>
                </div>
              </div>
              {/* Aesthetic Background Detail */}
              <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none">
                <span className="material-symbols-outlined text-[300px]">shield</span>
              </div>
            </div>

            {/* Action Row Vertical */}
            <div className="col-span-4 grid grid-cols-2 gap-4">
              <button className="flex flex-col items-center justify-center gap-3 bg-surface-container-lowest rounded-xl p-4 hover:bg-surface-container transition-colors group">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                  <span className="material-symbols-outlined">add_circle</span>
                </div>
                <span className="text-xs font-bold font-headline">Top Up</span>
              </button>
              <button className="flex flex-col items-center justify-center gap-3 bg-surface-container-lowest rounded-xl p-4 hover:bg-surface-container transition-colors group">
                <div className="w-12 h-12 rounded-full bg-secondary/10 flex items-center justify-center text-secondary group-hover:bg-secondary group-hover:text-white transition-all">
                  <span className="material-symbols-outlined">swap_horiz</span>
                </div>
                <span className="text-xs font-bold font-headline">Transfer</span>
              </button>
              <button className="flex flex-col items-center justify-center gap-3 bg-surface-container-lowest rounded-xl p-4 hover:bg-surface-container transition-colors group">
                <div className="w-12 h-12 rounded-full bg-tertiary/10 flex items-center justify-center text-tertiary group-hover:bg-tertiary group-hover:text-white transition-all">
                  <span className="material-symbols-outlined">request_quote</span>
                </div>
                <span className="text-xs font-bold font-headline">Request</span>
              </button>
              <button className="flex flex-col items-center justify-center gap-3 bg-surface-container-lowest rounded-xl p-4 hover:bg-surface-container transition-colors group">
                <div className="w-12 h-12 rounded-full bg-outline/10 flex items-center justify-center text-outline group-hover:bg-on-surface group-hover:text-white transition-all">
                  <span className="material-symbols-outlined">history</span>
                </div>
                <span className="text-xs font-bold font-headline">History</span>
              </button>
            </div>
          </section>

          {/* Quick Stats Row */}
          <section className="grid grid-cols-3 gap-6">
            <div className="bg-surface-container-lowest p-6 rounded-xl flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined">trending_up</span>
              </div>
              <div>
                <p className="text-xs font-medium text-outline">Total Income</p>
                <div className="flex items-baseline gap-2">
                  <h4 className="text-xl font-bold font-headline">Rp {totalIncome.toLocaleString('id-ID')}</h4>
                  <span className="text-[10px] text-primary font-bold flex items-center">+4.2%</span>
                </div>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-6 rounded-xl flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center text-error">
                <span className="material-symbols-outlined">trending_down</span>
              </div>
              <div>
                <p className="text-xs font-medium text-outline">Total Expenses</p>
                <div className="flex items-baseline gap-2">
                  <h4 className="text-xl font-bold font-headline">Rp {totalExpense.toLocaleString('id-ID')}</h4>
                  <span className="text-[10px] text-error font-bold flex items-center">-1.8%</span>
                </div>
              </div>
            </div>
            <div className="bg-surface-container-lowest p-6 rounded-xl flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary-fixed flex items-center justify-center text-on-primary-fixed-variant">
                <span className="material-symbols-outlined">account_balance_wallet</span>
              </div>
              <div>
                <p className="text-xs font-medium text-outline">Net Savings</p>
                <div className="flex items-baseline gap-2">
                  <h4 className="text-xl font-bold font-headline">Rp {balance.toLocaleString('id-ID')}</h4>
                  <span className="text-[10px] text-primary font-bold flex items-center">+12%</span>
                </div>
              </div>
            </div>
          </section>

          {/* Cashflow Chart & Transactions Asymmetric Grid */}
          <section className="grid grid-cols-12 gap-6 items-start">
            {/* Monthly Cashflow */}
            <div className="col-span-7 bg-surface-container-lowest p-8 rounded-xl h-[420px] flex flex-col">
              <div className="flex justify-between items-center mb-8">
                <div>
                  <h3 className="text-lg font-bold font-headline">Wealth Dynamics</h3>
                  <p className="text-xs text-outline font-medium">Income vs expense analysis</p>
                </div>
              </div>
              <div className="flex-1 w-full h-full pb-2">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ebefed" vertical={false} />
                      <XAxis dataKey="displayDate" stroke="#6f7a72" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#6f7a72" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `Rp ${value / 1000}k`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: '#ebefed', borderRadius: '8px', fontSize: '12px' }}
                        itemStyle={{ color: '#181c1b' }}
                      />
                      <Bar dataKey="income" fill="#0d6946" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      <Bar dataKey="expense" fill="#af5c5f" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      <Line type="monotone" dataKey="balance" stroke="#31835d" strokeWidth={3} dot={{ r: 4, fill: '#31835d', strokeWidth: 2, stroke: '#ffffff' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-outline text-sm">No data available</div>
                )}
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="col-span-5 bg-surface-container-lowest p-8 rounded-xl h-[420px] overflow-hidden flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold font-headline">Transactions</h3>
                <a className="text-xs font-bold text-primary hover:underline" href="#">View All</a>
              </div>
              <div className="space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {transactions.slice(0, 10).map(tx => (
                  <div key={tx.id} className="flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.type === 'income' ? 'bg-primary-container/20 text-primary' : 'bg-error-container/50 text-error'}`}>
                        <span className="material-symbols-outlined">{tx.type === 'income' ? 'arrow_downward' : 'arrow_upward'}</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold font-headline">{tx.category || 'Transaction'}</p>
                        <p className="text-[10px] text-outline">{format(new Date(tx.date), 'MMM dd, yyyy')} • {tx.description}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${tx.type === 'income' ? 'text-primary' : 'text-error'}`}>
                        {tx.type === 'income' ? '+' : '-'}Rp {tx.amount.toLocaleString('id-ID')}
                      </p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${tx.type === 'income' ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-error-container text-on-error-container'}`}>
                        Completed
                      </span>
                    </div>
                  </div>
                ))}
                {transactions.length === 0 && (
                  <div className="text-center text-outline text-sm mt-10">No transactions yet.</div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Right Panel */}
      <aside className="fixed right-0 top-0 h-screen w-[300px] bg-white shadow-xl shadow-emerald-950/5 p-6 overflow-y-auto border-l border-surface-container z-40">
        <div className="mt-20 space-y-8">
          {/* WhatsApp Setup & Reset */}
          <div className="bg-surface-container rounded-xl p-6 text-center">
            <span className="material-symbols-outlined text-primary text-3xl mb-2">chat</span>
            <h4 className="text-sm font-bold font-headline mb-2">WhatsApp Connected</h4>
            <p className="text-[10px] text-outline mb-4 leading-relaxed">
              Send voice notes or text to <strong className="text-on-surface">{whatsappNumber}</strong> to record transactions automatically.
            </p>
            <button onClick={() => setIsResetModalOpen(true)} className="w-full py-2 bg-error/10 text-error text-xs font-bold rounded-full hover:bg-error/20 transition-all flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-[16px]">delete</span>
              Reset Data
            </button>
          </div>

          {/* Statistics Card: Donut Chart */}
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-md font-bold font-headline">Allocation</h3>
              <button className="text-primary"><span className="material-symbols-outlined">more_horiz</span></button>
            </div>
            <div className="relative w-48 h-48 mx-auto flex items-center justify-center">
              {/* SVG Donut Chart Mockup */}
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="96" cy="96" fill="transparent" r="70" stroke="#ebefed" strokeWidth="24"></circle>
                <circle cx="96" cy="96" fill="transparent" r="70" stroke="#0d6946" strokeDasharray="439.8" strokeDashoffset="110" strokeWidth="24"></circle>
                <circle cx="96" cy="96" fill="transparent" r="70" stroke="#31835d" strokeDasharray="439.8" strokeDashoffset="300" strokeWidth="24"></circle>
                <circle cx="96" cy="96" fill="transparent" r="70" stroke="#af5c5f" strokeDasharray="439.8" strokeDashoffset="400" strokeWidth="24"></circle>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-[10px] text-outline font-bold uppercase tracking-widest">Total</p>
                <p className="text-lg font-extrabold font-headline">100%</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary"></div>
                <span className="text-xs font-medium text-outline">Real Estate</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary-container"></div>
                <span className="text-xs font-medium text-outline">Stocks</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-tertiary-container"></div>
                <span className="text-xs font-medium text-outline">Crypto</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-surface-container-highest"></div>
                <span className="text-xs font-medium text-outline">Cash</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Reset Modal */}
      {isResetModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-container-lowest border border-surface-container rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-on-surface font-headline mb-2">Reset All Data?</h3>
            <p className="text-outline mb-6 text-sm">
              This will permanently delete all your transactions. Your balance will be reset to zero, and the "DAILY FINAN-CHECK" logs will start fresh. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setIsResetModalOpen(false)}
                disabled={isResetting}
                className="px-4 py-2 text-sm font-medium text-outline hover:text-on-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={isResetting}
                className="px-4 py-2 bg-error hover:bg-error/90 disabled:bg-error/50 text-white text-sm font-bold rounded-xl transition-colors flex items-center gap-2"
              >
                {isResetting ? 'Resetting...' : 'Yes, Reset Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
