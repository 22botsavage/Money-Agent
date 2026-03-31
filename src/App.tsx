import React, { useEffect, useState, useMemo } from 'react';
import { auth, db, signInWithEmail, signUpWithEmail, logOut } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
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
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    if (loading) {
      setLoadingProgress(0);
      const startTime = performance.now();
      let animationFrameId: number;

      const updateProgress = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        let progress = 0;

        if (elapsed < 1200) {
          // 0% - 70% in 1200ms (Aggressive)
          const t = elapsed / 1200;
          const ease = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // easeOutExpo
          progress = 70 * ease;
        } else if (elapsed < 2700) {
          // 71% - 92% in 1500ms (Slow_Down)
          const t = (elapsed - 1200) / 1500;
          const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
          progress = 70 + (22 * ease);
        } else if (elapsed < 3500) {
          // 93% - 99% in 800ms (Hold_Minimum)
          const t = (elapsed - 2700) / 800;
          progress = 92 + (7 * t); // linear
        } else {
          progress = 100;
        }

        setLoadingProgress(Math.min(Math.round(progress), 100));

        if (elapsed < 3500) {
          animationFrameId = requestAnimationFrame(updateProgress);
        } else {
          setLoading(false);
        }
      };

      animationFrameId = requestAnimationFrame(updateProgress);

      return () => cancelAnimationFrame(animationFrameId);
    }
  }, [loading]);

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
            setLoading(false);
          }
        } catch (error) {
          console.error("Error fetching user:", error);
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
      setIsAuthReady(true);
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
    
    setLoading(true);
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
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setLoading(true);
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (error: any) {
      setAuthError(error.message || 'Authentication failed');
      setLoading(false);
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
    let headerText = "Preparing your budget";
    let subText = "Syncing financial data...";
    let pillText = `Syncing • ${loadingProgress}%`;
    let motionState = "Blur_In";

    if (loadingProgress > 70 && loadingProgress <= 92) {
      headerText = "Building your plan";
      subText = "Analyzing spending patterns.";
      pillText = `Calculating • ${loadingProgress}%`;
      motionState = "Focus_Shift";
    } else if (loadingProgress > 92) {
      headerText = "Almost there";
      subText = "Finalizing your strategy.";
      pillText = `Processing • ${loadingProgress}%`;
      motionState = "Expansion_Glow";
    }

    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
        className="min-h-screen flex flex-col items-center justify-center font-body px-4"
        style={{ background: 'radial-gradient(circle at center, #FAFAFA 0%, #F2F2F2 100%)' }}
      >
        <div className="relative w-24 h-24 mb-8 flex items-center justify-center">
          {/* Circular Progress Track */}
          <motion.svg 
            className="absolute inset-0 w-full h-full" 
            viewBox="0 0 100 100"
            initial={{ rotate: -90 }}
            animate={{ rotate: 270 }}
            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
          >
            <circle 
              cx="50" cy="50" r="48" 
              fill="none" 
              stroke="#E0E0E0" 
              strokeWidth="2" 
            />
            {/* Circular Progress Indicator */}
            <motion.circle 
              cx="50" cy="50" r="48" 
              fill="none" 
              stroke="#27AE60" 
              strokeWidth="2" 
              strokeDasharray="301.59"
              strokeLinecap="round"
              initial={{ strokeDashoffset: 301.59 }}
              animate={{ strokeDashoffset: 301.59 - (loadingProgress / 100) * 301.59 }}
              transition={{ duration: 0.1, ease: "linear" }}
            />
          </motion.svg>
          
          {/* Center Widget */}
          <motion.div 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 15 }}
            className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30 z-10"
          >
            <span className="material-symbols-outlined text-white text-3xl" style={{ color: '#FFFFFF' }}>bar_chart</span>
          </motion.div>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="text-center max-w-sm"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={motionState}
              initial={{ 
                opacity: 0, 
                filter: motionState === 'Blur_In' ? 'blur(8px)' : 'blur(4px)', 
                scale: motionState === 'Expansion_Glow' ? 0.95 : 1 
              }}
              animate={{ 
                opacity: 1, 
                filter: 'blur(0px)', 
                scale: 1 
              }}
              exit={{ 
                opacity: 0, 
                filter: motionState === 'Blur_In' ? 'blur(8px)' : 'blur(4px)', 
                scale: motionState === 'Expansion_Glow' ? 1.05 : 1 
              }}
              transition={{ 
                duration: 0.4, 
                ease: [0.83, 0, 0.17, 1] // Ease-In-Out Quintic approximation
              }}
            >
              <h2 
                className="font-headline mb-3 tracking-tight" 
                style={{ fontWeight: 700, color: '#122620', fontSize: '24px' }}
              >
                {headerText}
              </h2>
              <p 
                className="mb-8 leading-relaxed"
                style={{ fontWeight: 400, color: '#4A4A4A', fontSize: '16px', textAlign: 'center' }}
              >
                {subText}
              </p>
            </motion.div>
          </AnimatePresence>
          
          {/* Backend Simulation Details */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-medium px-4 py-2 rounded-full bg-black/5 text-[#4A4A4A]">
              <span className="w-2 h-2 rounded-full bg-[#27AE60] animate-pulse"></span>
              {pillText}
            </div>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-4 font-body text-on-surface">
        <div className="bg-surface-container-lowest p-6 sm:p-8 rounded-2xl shadow-xl shadow-emerald-900/5 max-w-md w-full border border-surface-container">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-primary font-headline tracking-tight">Money Agent</h1>
            <p className="text-xs uppercase tracking-widest text-outline font-medium mt-1">Your Personal Money Manager</p>
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
              className="w-full py-3 bg-primary text-white text-sm font-bold rounded-xl shadow-sm hover:shadow-md hover:bg-primary/90 hover:-translate-y-0.5 active:scale-95 transition-all mt-6"
            >
              {isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-sm text-primary hover:underline font-medium active:scale-95 transition-transform"
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
        <div className="bg-surface-container-lowest p-6 sm:p-8 rounded-2xl shadow-xl shadow-emerald-900/5 max-w-md w-full border border-surface-container">
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
              className="w-full py-3 bg-primary text-white text-sm font-bold rounded-xl shadow-sm hover:shadow-md hover:bg-primary/90 hover:-translate-y-0.5 active:scale-95 transition-all mt-4"
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

  const renderRightPanel = () => (
    <div className="space-y-8">
      {/* Statistics Card: Donut Chart */}
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-md font-bold font-headline">Allocation</h3>
          <button className="text-primary hover:text-primary/80 active:scale-95 transition-transform"><span className="material-symbols-outlined">more_horiz</span></button>
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

      {/* Recent Activity Feed */}
      <div className="space-y-6">
        <h3 className="text-md font-bold font-headline">Activity</h3>
        <div className="space-y-6 relative before:absolute before:left-4 before:top-2 before:bottom-0 before:w-px before:bg-surface-container">
          <div className="relative pl-10">
            <div className="absolute left-0 top-0 w-8 h-8 rounded-full overflow-hidden border-2 border-white bg-white z-10 shadow-sm">
              <img alt="Activity Actor 1" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDiBDRww5KjV0sEIxJdZAtxiz3de3-jVeQTdJkeMuIdPe9u6H6DcQJpX__Lo2RNB3FSpViw0Vhmd3_UkwWmFuK9HqVzdtlopOvZLcVKAf0DHpwVjczVPej96wz_Fof0oBpWqySsQcsCft6ZchTOEeKbAmrvMh2s3A_4PCXYqwOjrFYw-BXD5MqhaFlrYLJC_9aZ9IYU_XfQUCoL3e111uLa_LXNxN1W-K2arSp3js32-RE0g3rOn0XD9PKCp9Y74--MYBxHtdZu_UYj"/>
            </div>
            <div>
              <p className="text-xs"><span className="font-bold">Marcus Thorne</span> initiated a wire transfer of <span className="font-bold">$25,000</span>.</p>
              <p className="text-[10px] text-outline mt-1 font-medium">10 mins ago</p>
            </div>
          </div>
          <div className="relative pl-10">
            <div className="absolute left-0 top-0 w-8 h-8 rounded-full overflow-hidden border-2 border-white bg-white z-10 shadow-sm flex items-center justify-center bg-primary text-white">
              <span className="material-symbols-outlined text-sm">security</span>
            </div>
            <div>
              <p className="text-xs">System security audit completed. All assets are <span className="text-primary font-bold">100% verified</span>.</p>
              <p className="text-[10px] text-outline mt-1 font-medium">2 hours ago</p>
            </div>
          </div>
          <div className="relative pl-10">
            <div className="absolute left-0 top-0 w-8 h-8 rounded-full overflow-hidden border-2 border-white bg-white z-10 shadow-sm">
              <img alt="Activity Actor 2" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuB0nWk3LImKs9P6LKtPuGfmjzlYNMNY7sf2UyfUDgIJKuh8C9t6Jb5efol4DdZhuU4Z4oKaC3Qm4Qo9qrd-0QBAkgbkF8lJFmQil0ryf1VB1Rw6GuF6ZllBcUNfEHnD1GEFBmdypEAjDgdK3uttxwWjKYT8y8t9kFGVKhL6hsQBTO5UNfBf5cEKzGikmedPaaPlHqpmnI16RiDCLbgE39JtLEFUKdDutlcTUVg7ddy0kb3A3eGeZuuUtZGoq4tzyaR8YVl73ufqPXb_"/>
            </div>
            <div>
              <p className="text-xs"><span className="font-bold">Advisor Elena</span> shared a new Investment Report.</p>
              <button className="mt-2 flex items-center gap-2 bg-surface-container rounded-lg px-3 py-1.5 group hover:bg-surface-container-high active:scale-95 transition-all">
                <span className="material-symbols-outlined text-[14px]">description</span>
                <span className="text-[10px] font-bold">Q3_Outlook.pdf</span>
              </button>
              <p className="text-[10px] text-outline mt-1 font-medium">5 hours ago</p>
            </div>
          </div>
        </div>
      </div>

      {/* Promotion / Secondary CTA */}
      <div className="bg-surface-container rounded-xl p-6 text-center">
        <span className="material-symbols-outlined text-primary text-3xl mb-2">auto_awesome</span>
        <h4 className="text-sm font-bold font-headline mb-2">Upgrade to Platinum</h4>
        <p className="text-[10px] text-outline mb-4 leading-relaxed">Unlock 24/7 concierge support and lower transaction fees.</p>
        <button className="w-full py-2 bg-on-surface text-white text-xs font-bold rounded-full hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition-all">
          Explore Benefits
        </button>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-bold font-headline text-on-surface">Settings</h2>
        <p className="text-sm text-outline mt-1">Manage your account, integrations, and data.</p>
      </div>

      <div className="bg-surface-container-lowest border border-surface-container rounded-2xl p-6 sm:p-8 space-y-8 shadow-sm">
        {/* Profile Section */}
        <div>
          <h3 className="text-lg font-bold font-headline mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">person</span>
            Profile Information
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-outline uppercase tracking-wider mb-1">Email Address</label>
              <p className="text-sm font-medium text-on-surface">{user.email}</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-outline uppercase tracking-wider mb-1">Account Tier</label>
              <p className="text-sm font-medium text-on-surface">Private Tier Client</p>
            </div>
          </div>
        </div>

        <hr className="border-surface-container" />

        {/* Integrations Section */}
        <div>
          <h3 className="text-lg font-bold font-headline mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">integration_instructions</span>
            Integrations
          </h3>
          <div className="bg-primary-container/10 border border-primary/20 rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0">
                <span className="material-symbols-outlined">chat</span>
              </div>
              <div>
                <h4 className="text-sm font-bold font-headline text-on-surface">WhatsApp Connected</h4>
                <p className="text-xs text-outline mt-1">
                  Receiving transactions from <strong className="text-on-surface">{whatsappNumber}</strong>
                </p>
              </div>
            </div>
            <span className="px-3 py-1 bg-primary-fixed text-on-primary-fixed-variant text-[10px] font-bold rounded-full uppercase tracking-widest">Active</span>
          </div>
        </div>

        <hr className="border-surface-container" />

        {/* Data Management Section */}
        <div>
          <h3 className="text-lg font-bold font-headline mb-4 flex items-center gap-2 text-error">
            <span className="material-symbols-outlined">warning</span>
            Danger Zone
          </h3>
          <div className="bg-error-container/30 border border-error/20 rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-bold font-headline text-on-surface">Reset All Data</h4>
              <p className="text-xs text-outline mt-1 max-w-md">
                Permanently delete all your transactions. Your balance will be reset to zero. This action cannot be undone.
              </p>
            </div>
            <button 
              onClick={() => setIsResetModalOpen(true)} 
              className="px-4 py-2 bg-error text-white text-xs font-bold rounded-xl hover:bg-error/90 hover:-translate-y-0.5 active:scale-95 transition-all flex items-center gap-2 shrink-0 shadow-sm"
            >
              <span className="material-symbols-outlined text-[16px]">delete_forever</span>
              Reset Data
            </button>
          </div>
        </div>

      </div>
    </div>
  );

  return (
    <div className="bg-surface font-body text-on-surface antialiased min-h-screen flex overflow-x-hidden">
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity" 
          onClick={() => setIsMobileMenuOpen(false)} 
        />
      )}

      {/* Sidebar Layout */}
      <aside className={`fixed left-0 top-0 h-screen w-64 bg-surface-container-lowest lg:bg-emerald-50/50 flex flex-col p-4 space-y-2 z-50 border-r border-surface-container transition-transform duration-300 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="mb-8 px-4 py-2 flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold text-primary font-headline tracking-tight">Money Agent</h1>
            <p className="text-[10px] uppercase tracking-widest text-primary/60 font-medium">Your Personal Money Manager</p>
          </div>
          <button className="lg:hidden text-outline hover:text-primary active:scale-95 transition-transform" onClick={() => setIsMobileMenuOpen(false)}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <nav className="flex-1 space-y-1">
          <button onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:scale-95 ${activeTab === 'dashboard' ? 'text-primary font-semibold bg-white shadow-sm' : 'text-outline hover:text-primary hover:bg-emerald-100/50'}`}>
            <span className="material-symbols-outlined">dashboard</span>
            <span className="text-sm font-label font-medium">Dashboard</span>
          </button>
          <a className="flex items-center gap-3 px-4 py-3 text-outline hover:text-primary transition-all active:scale-95 hover:bg-emerald-100/50 rounded-xl" href="#">
            <span className="material-symbols-outlined">payments</span>
            <span className="text-sm font-label font-medium">Payments</span>
          </a>
          <a className="flex items-center gap-3 px-4 py-3 text-outline hover:text-primary transition-all active:scale-95 hover:bg-emerald-100/50 rounded-xl" href="#">
            <span className="material-symbols-outlined">receipt_long</span>
            <span className="text-sm font-label font-medium">Transactions</span>
          </a>
          <a className="flex items-center gap-3 px-4 py-3 text-outline hover:text-primary transition-all active:scale-95 hover:bg-emerald-100/50 rounded-xl" href="#">
            <span className="material-symbols-outlined">trending_up</span>
            <span className="text-sm font-label font-medium">Investments</span>
          </a>
        </nav>
        
        {/* CTA Card */}
        <div className="mt-auto p-4 bg-primary-container rounded-xl text-white relative overflow-hidden group mb-4">
          <div className="absolute -right-4 -top-4 w-16 h-16 bg-white/10 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
          <p className="text-xs font-medium text-primary-fixed mb-1">Portfolio Insight</p>
          <h4 className="text-sm font-bold font-headline mb-3 leading-tight">Ready for a new asset?</h4>
          <button className="w-full py-2 bg-white text-primary text-xs font-bold rounded-full shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-95 transition-all">
            New Transaction
          </button>
        </div>

        <div className="pt-4 border-t border-emerald-900/5 space-y-1">
          <button onClick={() => { setActiveTab('settings'); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:scale-95 ${activeTab === 'settings' ? 'text-primary font-semibold bg-white shadow-sm' : 'text-outline hover:text-primary hover:bg-emerald-100/50'}`}>
            <span className="material-symbols-outlined">settings</span>
            <span className="text-sm font-label font-medium">Settings</span>
          </button>
          <button onClick={logOut} className="w-full flex items-center gap-3 px-4 py-3 text-outline hover:text-primary active:scale-95 transition-all">
            <span className="material-symbols-outlined">logout</span>
            <span className="text-sm font-label font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Wrapper */}
      <div className="flex-1 flex flex-col w-full lg:ml-64 xl:mr-[300px] min-h-screen transition-all duration-300">
        {/* Top Navigation */}
        <header className="fixed top-0 left-0 lg:left-64 right-0 xl:right-[300px] h-16 z-30 bg-white/80 backdrop-blur-xl shadow-sm shadow-emerald-900/5 flex justify-between items-center px-4 sm:px-8 transition-all duration-300">
          <div className="flex items-center gap-4 w-full max-w-md">
            <button className="lg:hidden text-outline hover:text-primary flex items-center justify-center active:scale-95 transition-transform" onClick={() => setIsMobileMenuOpen(true)}>
              <span className="material-symbols-outlined">menu</span>
            </button>
            <div className="relative w-full hidden sm:block">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm">search</span>
              <input className="w-full bg-surface-container-low border-none rounded-full pl-10 pr-4 py-2 text-sm focus:ring-1 focus:ring-primary/30 transition-all placeholder:text-outline-variant" placeholder="Search wealth assets, reports..." type="text"/>
            </div>
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2 sm:gap-4">
              <button className="text-outline hover:text-primary transition-all hover:scale-110 active:scale-95 hidden sm:block">
                <span className="material-symbols-outlined">help_outline</span>
              </button>
              <button 
                onClick={() => {
                  window.location.reload();
                }}
                className="text-outline hover:text-primary transition-all hover:scale-110 active:scale-95 relative"
                title="Refresh"
              >
                <span className="material-symbols-outlined">refresh</span>
              </button>
              <button className="text-outline hover:text-primary transition-all hover:scale-110 active:scale-95 relative">
                <span className="material-symbols-outlined">notifications</span>
                <span className="absolute top-0 right-0 w-2 h-2 bg-error rounded-full border-2 border-white"></span>
              </button>
            </div>
            <div className="h-8 w-px bg-outline-variant/20 mx-1 sm:mx-2"></div>
            <div className="flex items-center gap-3 group">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold font-headline text-on-surface leading-tight">{user.email?.split('@')[0]}</p>
                <p className="text-[10px] text-outline font-medium">Private Tier Client</p>
              </div>
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary-container flex items-center justify-center text-white font-bold border-2 border-primary/10">
                {user.email?.charAt(0).toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 pt-20 sm:pt-24 px-4 sm:px-8 pb-12 space-y-6 sm:space-y-8 max-w-[100vw] lg:max-w-none overflow-hidden">
          {activeTab === 'dashboard' && (
            <>
              {/* Hero Section: Balance & Action Grid */}
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-300">
                {/* Primary Balance Card */}
                <div className="col-span-1 lg:col-span-8 primary-gradient rounded-xl p-6 sm:p-8 text-white relative overflow-hidden shadow-xl shadow-primary/20">
                  <div className="relative z-10 flex flex-col h-full justify-between min-h-[160px]">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                      <div>
                        <p className="text-primary-fixed/80 text-xs sm:text-sm font-medium mb-1">Total Available Wealth</p>
                        <h2 className="text-4xl sm:text-5xl font-extrabold font-headline tracking-tight">Rp {balance.toLocaleString('id-ID')}</h2>
                      </div>
                      <span className="bg-white/10 backdrop-blur px-3 py-1 rounded-full text-[10px] sm:text-xs font-semibold flex items-center gap-1 self-start">
                        <span className="material-symbols-outlined text-[14px]">verified</span>
                        Secured Assets
                      </span>
                    </div>
                    <div className="mt-8 sm:mt-12 flex items-center gap-6 sm:gap-8">
                      <div>
                        <p className="text-primary-fixed/60 text-[8px] sm:text-[10px] uppercase font-bold tracking-widest mb-1">Portfolio Yield</p>
                        <p className="text-lg sm:text-xl font-bold font-headline">+12.4% <span className="text-xs sm:text-sm font-normal opacity-70">y/y</span></p>
                      </div>
                      <div className="w-px h-8 sm:h-10 bg-white/20"></div>
                      <div>
                        <p className="text-primary-fixed/60 text-[8px] sm:text-[10px] uppercase font-bold tracking-widest mb-1">Risk Profile</p>
                        <p className="text-lg sm:text-xl font-bold font-headline">Conservative</p>
                      </div>
                    </div>
                  </div>
                  {/* Aesthetic Background Detail */}
                  <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none">
                    <span className="material-symbols-outlined text-[200px] sm:text-[300px]">shield</span>
                  </div>
                </div>

                {/* Action Row Vertical */}
                <div className="col-span-1 lg:col-span-4 grid grid-cols-4 sm:grid-cols-4 lg:grid-cols-2 gap-3 sm:gap-4">
                  <button className="flex flex-col items-center justify-center gap-2 sm:gap-3 bg-surface-container-lowest rounded-xl p-3 sm:p-4 hover:bg-surface-container hover:-translate-y-1 active:scale-95 transition-all group">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                      <span className="material-symbols-outlined text-[20px] sm:text-[24px]">account_balance_wallet</span>
                    </div>
                    <span className="text-[10px] sm:text-xs font-bold font-headline">Top Up</span>
                  </button>
                  <button className="flex flex-col items-center justify-center gap-2 sm:gap-3 bg-surface-container-lowest rounded-xl p-3 sm:p-4 hover:bg-surface-container hover:-translate-y-1 active:scale-95 transition-all group">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-secondary/10 flex items-center justify-center text-secondary group-hover:bg-secondary group-hover:text-white transition-all">
                      <span className="material-symbols-outlined text-[20px] sm:text-[24px]">send_money</span>
                    </div>
                    <span className="text-[10px] sm:text-xs font-bold font-headline">Transfer</span>
                  </button>
                  <button className="flex flex-col items-center justify-center gap-2 sm:gap-3 bg-surface-container-lowest rounded-xl p-3 sm:p-4 hover:bg-surface-container hover:-translate-y-1 active:scale-95 transition-all group">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-tertiary/10 flex items-center justify-center text-tertiary group-hover:bg-tertiary group-hover:text-white transition-all">
                      <span className="material-symbols-outlined text-[20px] sm:text-[24px]">payments</span>
                    </div>
                    <span className="text-[10px] sm:text-xs font-bold font-headline">Request</span>
                  </button>
                  <button className="flex flex-col items-center justify-center gap-2 sm:gap-3 bg-surface-container-lowest rounded-xl p-3 sm:p-4 hover:bg-surface-container hover:-translate-y-1 active:scale-95 transition-all group">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-outline/10 flex items-center justify-center text-outline group-hover:bg-on-surface group-hover:text-white transition-all">
                      <span className="material-symbols-outlined text-[20px] sm:text-[24px]">receipt_long</span>
                    </div>
                    <span className="text-[10px] sm:text-xs font-bold font-headline">History</span>
                  </button>
                </div>
              </section>

              {/* Quick Stats Row */}
              <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 animate-in fade-in duration-300">
                <div className="bg-surface-container-lowest p-4 sm:p-6 rounded-xl flex items-center gap-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined">trending_up</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] sm:text-xs font-medium text-outline truncate">Total Income</p>
                    <div className="flex items-baseline gap-2">
                      <h4 className="text-lg sm:text-xl font-bold font-headline truncate">Rp {totalIncome.toLocaleString('id-ID')}</h4>
                    </div>
                  </div>
                </div>
                <div className="bg-surface-container-lowest p-4 sm:p-6 rounded-xl flex items-center gap-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-red-50 flex items-center justify-center text-error shrink-0">
                    <span className="material-symbols-outlined">trending_down</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] sm:text-xs font-medium text-outline truncate">Total Expenses</p>
                    <div className="flex items-baseline gap-2">
                      <h4 className="text-lg sm:text-xl font-bold font-headline truncate">Rp {totalExpense.toLocaleString('id-ID')}</h4>
                    </div>
                  </div>
                </div>
                <div className="bg-surface-container-lowest p-4 sm:p-6 rounded-xl flex items-center gap-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary flex items-center justify-center text-white shrink-0">
                    <span className="material-symbols-outlined">account_balance_wallet</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] sm:text-xs font-medium text-outline truncate">Net Savings</p>
                    <div className="flex items-baseline gap-2">
                      <h4 className="text-lg sm:text-xl font-bold font-headline truncate">Rp {balance.toLocaleString('id-ID')}</h4>
                    </div>
                  </div>
                </div>
              </section>

              {/* Charts & Transactions */}
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-in fade-in duration-300">
                {/* Monthly Cashflow */}
                <div className="col-span-1 lg:col-span-7 bg-surface-container-lowest p-4 sm:p-8 rounded-xl h-[350px] sm:h-[420px] flex flex-col">
                  <div className="flex justify-between items-center mb-4 sm:mb-8">
                    <div>
                      <h3 className="text-base sm:text-lg font-bold font-headline">Wealth Dynamics</h3>
                      <p className="text-[10px] sm:text-xs text-outline font-medium">Income vs expense analysis</p>
                    </div>
                  </div>
                  <div className="flex-1 w-full h-full pb-2 min-h-[200px]">
                    {chartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#ebefed" vertical={false} />
                          <XAxis dataKey="displayDate" stroke="#6f7a72" fontSize={10} tickLine={false} axisLine={false} />
                          <YAxis stroke="#6f7a72" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `Rp ${value / 1000}k`} width={60} />
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
                <div className="col-span-1 lg:col-span-5 bg-surface-container-lowest p-4 sm:p-8 rounded-xl h-[400px] sm:h-[420px] overflow-hidden flex flex-col">
                  <div className="flex justify-between items-center mb-4 sm:mb-6">
                    <h3 className="text-base sm:text-lg font-bold font-headline">Transactions</h3>
                    <a className="text-[10px] sm:text-xs font-bold text-primary hover:underline active:scale-95 transition-transform" href="#">View All</a>
                  </div>
                  <div className="space-y-4 sm:space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                    {transactions.slice(0, 10).map(tx => (
                      <div key={tx.id} className="flex items-center justify-between group">
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 ${tx.type === 'income' ? 'bg-primary-container/20 text-primary' : 'bg-error-container/50 text-error'}`}>
                            <span className="material-symbols-outlined text-[18px] sm:text-[24px]">{tx.type === 'income' ? 'arrow_downward' : 'arrow_upward'}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-bold font-headline truncate">{tx.category || 'Transaction'}</p>
                            <p className="text-[9px] sm:text-[10px] text-outline truncate">{format(new Date(tx.date), 'MMM dd, yyyy')} • {tx.description}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-xs sm:text-sm font-bold ${tx.type === 'income' ? 'text-primary' : 'text-error'}`}>
                            {tx.type === 'income' ? '+' : '-'}Rp {tx.amount.toLocaleString('id-ID')}
                          </p>
                          <span className={`text-[8px] sm:text-[10px] px-2 py-0.5 rounded-full font-bold inline-block mt-1 ${tx.type === 'income' ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-error-container text-on-error-container'}`}>
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

              {/* Mobile/Tablet Right Panel Content */}
              <section className="xl:hidden pt-8 border-t border-surface-container animate-in fade-in duration-300">
                {renderRightPanel()}
              </section>
            </>
          )}

          {activeTab === 'settings' && renderSettings()}
        </main>
      </div>

      {/* Desktop Right Panel */}
      <aside className="hidden xl:block fixed right-0 top-0 h-screen w-[300px] bg-white shadow-xl shadow-emerald-950/5 p-6 overflow-y-auto border-l border-surface-container z-20">
        <div className="mt-20">
          {renderRightPanel()}
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
                className="px-4 py-2 text-sm font-medium text-outline hover:text-on-surface active:scale-95 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                disabled={isResetting}
                className="px-4 py-2 bg-error hover:bg-error/90 disabled:bg-error/50 text-white text-sm font-bold rounded-xl active:scale-95 transition-all flex items-center gap-2"
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
