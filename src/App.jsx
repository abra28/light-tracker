import { useState, useEffect } from 'react';
import { collection, addDoc, query, getDocs, orderBy, limit, where, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { signInAnonymously, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LineChart, Line } from 'recharts';

function calcHours(onTime, offTime) {
  const [onH, onM] = onTime.split(':').map(Number);
  const [offH, offM] = offTime.split(':').map(Number);
  let onMin = onH * 60 + onM;
  let offMin = offH * 60 + offM;
  if (offMin <= onMin) offMin += 24 * 60;
  return ((offMin - onMin) / 60).toFixed(1);
}

function splitReport(date, onTime, offTime, durationHours, reporterName, notes) {
  const [onH, onM] = onTime.split(':').map(Number);
  const [offH, offM] = offTime.split(':').map(Number);
  const onMin = onH * 60 + onM;
  const offMin = offH * 60 + offM;
  
  if (offMin > onMin) {
    return [{
      date,
      lightOn: onTime,
      lightOff: offTime,
      durationHours: parseFloat(durationHours),
      reporterName,
      notes,
      createdAt: new Date().toISOString()
    }];
  }
  
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const todayDuration = (24 * 60 - onMin) / 60;
  const tomorrowDuration = offMin / 60;
  
  return [
    {
      date,
      lightOn: onTime,
      lightOff: '23:59',
      durationHours: parseFloat(todayDuration.toFixed(1)),
      reporterName,
      notes: notes + ' (Today portion)',
      createdAt: new Date().toISOString()
    },
    {
      date: tomorrow.toISOString().slice(0, 10),
      lightOn: '00:00',
      lightOff: offTime,
      durationHours: parseFloat(tomorrowDuration.toFixed(1)),
      reporterName,
      notes: notes + ' (Tomorrow portion)',
      createdAt: new Date().toISOString()
    }
  ];
}

export default function App() {
  const [user, setUser] = useState(null);
  const [reports, setReports] = useState([]);
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lightOn, setLightOn] = useState('');
  const [lightOff, setLightOff] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [showExport, setShowExport] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [duplicateDate, setDuplicateDate] = useState(null);
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [showExportDialog, setShowExportDialog] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) setName(u.displayName || 'Anonymous');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    const q = query(collection(db, 'reports'), orderBy('date', 'desc'), limit(100));
    const unsub = onSnapshot(q, (snapshot) => {
      setReports(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    
    return () => unsub();
  }, [user]);

  async function loginAnon() {
    await signInAnonymously(auth);
  }
  async function loginGoogle() {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }
  async function logout() {
    await signOut(auth);
    setIsAdmin(false);
  }

  async function submitReport(e) {
    e.preventDefault();
    if (!lightOn || !lightOff) return;

    setLoading(true);
    const hours = calcHours(lightOn, lightOff);

    const [onH, onM] = lightOn.split(':').map(Number);
    const [offH, offM] = lightOff.split(':').map(Number);
    const onMin = onH * 60 + onM;
    const offMin = offH * 60 + offM;
    
    const duplicateCheck = await getDocs(
      query(collection(db, 'reports'), where('date', '==', date))
    );
    
    const exactDuplicate = duplicateCheck.docs.some(doc => {
      const data = doc.data();
      return data.lightOn === lightOn && data.lightOff === lightOff;
    });
    
    if (exactDuplicate) {
      setDuplicateDate(`${date} ${lightOn}-${lightOff}`);
      setShowDuplicateWarning(true);
      setLoading(false);
      return;
    }

    let reportsToSubmit;
    if (offMin > onMin) {
      reportsToSubmit = [{
        date,
        lightOn,
        lightOff,
        durationHours: parseFloat(hours),
        reporterName: name || 'Anonymous',
        notes,
        createdAt: new Date().toISOString()
      }];
    } else {
      reportsToSubmit = splitReport(date, lightOn, lightOff, hours, name || 'Anonymous', notes);
    }

    for (const report of reportsToSubmit) {
      await addDoc(collection(db, 'reports'), report);
    }

    setLightOn('');
    setLightOff('');
    setNotes('');
    setLoading(false);
  }

  async function handleDeleteReport(reportId) {
    if (window.confirm('Are you sure you want to delete this report?')) {
      await deleteDoc(doc(db, 'reports', reportId));
    }
  }

  function handleAdminLogin() {
    if (adminPassword === 'admin123') {
      setIsAdmin(true);
      setShowAdminLogin(false);
      setAdminPassword('');
    } else {
      alert('Incorrect admin password');
    }
  }

  function getFilteredReportsForExport() {
    let filtered = reports;
    
    if (exportStartDate && exportEndDate) {
      filtered = reports.filter(r => {
        const reportDate = new Date(r.date);
        const start = new Date(exportStartDate);
        const end = new Date(exportEndDate);
        end.setDate(end.getDate() + 1);
        return reportDate >= start && reportDate < end;
      });
    } else {
      if (filter === 'today') {
        const today = new Date().toISOString().slice(0, 10);
        filtered = reports.filter(r => r.date === today);
      } else if (filter === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        filtered = reports.filter(r => new Date(r.date) >= weekAgo);
      } else if (filter === 'month') {
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        filtered = reports.filter(r => new Date(r.date) >= monthAgo);
      }
    }
    
    return filtered;
  }

  function exportCSV() {
    const filteredReports = getFilteredReportsForExport();
    const headers = 'Date,Light ON,Light OFF,Hours,Reporter,Notes\n';
    const rows = filteredReports.map(r => 
      `${r.date},${r.lightOn},${r.lightOff},${r.durationHours},${r.reporterName},${r.notes || ''}`
    ).join('\n');
    
    const csv = headers + rows;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `light-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  function exportPDF() {
    const filteredReports = getFilteredReportsForExport();
    const avgAll = filteredReports.length > 0
      ? (filteredReports.reduce((s, r) => s + parseFloat(r.durationHours), 0) / filteredReports.length).toFixed(1)
      : '0.0';
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekReports = filteredReports.filter(r => new Date(r.date) >= weekAgo);
    const weekAvg = weekReports.length > 0
      ? (weekReports.reduce((s, r) => s + parseFloat(r.durationHours), 0) / weekReports.length).toFixed(1)
      : '0.0';

    setShowExport(true);
    setTimeout(() => {
      window.print();
      setShowExport(false);
    }, 100);
  }

  const filteredReports = reports.filter(r => {
    if (filter === 'today') return r.date === new Date().toISOString().slice(0, 10);
    if (filter === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(r.date) >= weekAgo;
    }
    if (filter === 'month') {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return new Date(r.date) >= monthAgo;
    }
    return true;
  });

  const groupedByDate = {};
  filteredReports.forEach(r => {
    if (!groupedByDate[r.date]) {
      groupedByDate[r.date] = {
        date: r.date,
        totalHours: 0,
        reports: 0,
        reporters: new Set(),
        notes: []
      };
    }
    groupedByDate[r.date].totalHours += parseFloat(r.durationHours);
    groupedByDate[r.date].reports += 1;
    groupedByDate[r.date].reporters.add(r.reporterName);
    if (r.notes) groupedByDate[r.date].notes.push(r.notes);
  });

  const chartData = Object.values(groupedByDate)
    .slice(0, 14)
    .reverse()
    .map(r => ({
      date: r.date.slice(5),
      hours: parseFloat(r.totalHours.toFixed(1)),
      target: 16
    }));

  const today = new Date().toISOString().slice(0, 10);
  const todayGrouped = groupedByDate[today];
  const todayAvg = todayGrouped 
    ? (todayGrouped.totalHours / todayGrouped.reports).toFixed(1)
    : '0.0';

  const totalReports = filteredReports.length;
  const avgAll = totalReports > 0
    ? (filteredReports.reduce((s, r) => s + parseFloat(r.durationHours), 0) / totalReports).toFixed(1)
    : '0.0';

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekReports = filteredReports.filter(r => new Date(r.date) >= weekAgo);
  const weekAvg = weekReports.length > 0
    ? (weekReports.reduce((s, r) => s + parseFloat(r.durationHours), 0) / weekReports.length).toFixed(1)
    : '0.0';

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-2xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">⚡</div>
          <h1 className="text-3xl font-bold text-white mb-2">Arepo Light Tracker</h1>
          <p className="text-gray-400 mb-8">Document light outages. Fight back with data.</p>

          <button
            onClick={loginAnon}
            className="w-full bg-yellow-500 text-black font-bold py-4 rounded-xl text-lg mb-4 hover:bg-yellow-400 transition"
          >
            👤 Continue Anonymously
          </button>

          <button
            onClick={loginGoogle}
            className="w-full bg-white text-gray-900 font-bold py-4 rounded-xl text-lg mb-4 hover:bg-gray-100 transition"
          >
            🔵 Continue with Google
          </button>

          <p className="text-gray-500 text-sm">No password needed. Just your name.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="bg-gray-800 px-4 py-3 flex justify-between items-center sticky top-0 z-50">
        <div>
          <h1 className="text-xl font-bold">⚡ Arepo Light Tracker</h1>
          <p className="text-yellow-400 text-sm">Welcome, {name}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowExportDialog(true)} className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-green-500 transition">
            📊 Export
          </button>
          {isAdmin && (
            <button 
              onClick={logout}
              className="bg-purple-600 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-purple-500 transition"
            >
              🔒 Admin (Logout)
            </button>
          )}
          {!isAdmin && (
            <button 
              onClick={() => setShowAdminLogin(true)}
              className="bg-purple-600 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-purple-500 transition"
            >
              🔒 Admin
            </button>
          )}
          <button onClick={logout} className="text-gray-400 hover:text-white text-sm">
            🚪 Logout
          </button>
        </div>
      </div>

      {showAdminLogin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold mb-4">Admin Login</h3>
            <input
              type="password"
              value={adminPassword}
              onChange={e => setAdminPassword(e.target.value)}
              placeholder="Enter admin password"
              className="w-full bg-gray-700 p-3 rounded-xl text-white mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={handleAdminLogin}
                className="flex-1 bg-purple-600 text-white py-3 rounded-xl font-bold hover:bg-purple-500 transition"
              >
                Login
              </button>
              <button
                onClick={() => {
                  setShowAdminLogin(false);
                  setAdminPassword('');
                }}
                className="flex-1 bg-gray-700 text-white py-3 rounded-xl font-bold hover:bg-gray-600 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showDuplicateWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold mb-4">⚠️ Duplicate Entry</h3>
            <p className="text-gray-300 mb-4">
              This exact time entry ({duplicateDate}) already exists. Do you want to:
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setShowDuplicateWarning(false);
                  setLoading(false);
                }}
                className="w-full bg-gray-700 text-white py-3 rounded-xl font-bold hover:bg-gray-600 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDuplicateWarning(false);
                  setLoading(false);
                  setLightOn('');
                  setLightOff('');
                  setNotes('');
                }}
                className="w-full bg-yellow-500 text-black py-3 rounded-xl font-bold hover:bg-yellow-400 transition"
              >
                Add Anyway (Duplicate)
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold mb-4">Export Reports</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Start Date (optional)</label>
                <input
                  type="date"
                  value={exportStartDate}
                  onChange={e => setExportStartDate(e.target.value)}
                  className="w-full bg-gray-700 p-3 rounded-xl text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">End Date (optional)</label>
                <input
                  type="date"
                  value={exportEndDate}
                  onChange={e => setExportEndDate(e.target.value)}
                  className="w-full bg-gray-700 p-3 rounded-xl text-white"
                />
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    exportCSV();
                    setShowExportDialog(false);
                  }}
                  className="w-full bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-500 transition"
                >
                  📊 Export CSV
                </button>
                <button
                  onClick={() => {
                    exportPDF();
                    setShowExportDialog(false);
                  }}
                  className="w-full bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-500 transition"
                >
                  📄 Export PDF
                </button>
                <button
                  onClick={() => setShowExportDialog(false)}
                  className="w-full bg-gray-700 text-white py-3 rounded-xl font-bold hover:bg-gray-600 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-4 space-y-6">
        <div className="bg-gradient-to-r from-yellow-600 to-orange-600 rounded-2xl p-6 text-center">
          <p className="text-sm opacity-80">TODAY&apos;S AVERAGE</p>
          <p className="text-5xl font-bold my-2">{todayAvg}h</p>
          <p className="text-lg">
            Target: <strong>16h</strong>
            {parseFloat(todayAvg) < 16 && (
              <span className="ml-2 text-red-200">❌ Short by {(16 - parseFloat(todayAvg)).toFixed(1)}h</span>
            )}
            {parseFloat(todayAvg) >= 16 && (
              <span className="ml-2 text-green-200">✅ Target met!</span>
            )}
          </p>
          <div className="flex justify-center gap-6 mt-4 text-sm">
            <div>
              <span className="opacity-70">Today:</span> <strong>{todayGrouped ? todayGrouped.reports : 0} reports</strong>
            </div>
            <div>
              <span className="opacity-70">Week Avg:</span> <strong>{weekAvg}h</strong>
            </div>
            <div>
              <span className="opacity-70">Total:</span> <strong>{totalReports}</strong>
            </div>
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4 flex flex-wrap gap-2">
          <span className="text-gray-400 self-center mr-2">Filter:</span>
          {['all', 'today', 'week', 'month'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg font-bold capitalize transition ${
                filter === f ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="bg-gray-800 rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">📝 Report Light Status</h2>
          <form onSubmit={submitReport} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full bg-gray-700 p-3 rounded-xl text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Transformer exploded"
                  className="w-full bg-gray-700 p-3 rounded-xl text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Light ON ⏰</label>
                <input
                  type="time"
                  value={lightOn}
                  onChange={e => setLightOn(e.target.value)}
                  className="w-full bg-gray-700 p-3 rounded-xl text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Light OFF ⏰</label>
                <input
                  type="time"
                  value={lightOff}
                  onChange={e => setLightOff(e.target.value)}
                  className="w-full bg-gray-700 p-3 rounded-xl text-white"
                  required
                />
              </div>
            </div>

            {lightOn && lightOff && (
              <div className="bg-green-900/50 border border-green-500 rounded-xl p-4 text-center">
                <p className="text-green-400 text-lg">
                  ⏱️ Calculated: <strong className="text-white text-2xl">{calcHours(lightOn, lightOff)} hours</strong>
                  {(() => {
                    const [onH, onM] = lightOn.split(':').map(Number);
                    const [offH, offM] = lightOff.split(':').map(Number);
                    const onMin = onH * 60 + onM;
                    const offMin = offH * 60 + offM;
                    if (offMin <= onMin) {
                      return <span className="block text-yellow-300 mt-2">⚠️ This crosses midnight - will be split into two days</span>;
                    }
                    return null;
                  })()}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-yellow-500 text-black font-bold py-4 rounded-xl text-lg hover:bg-yellow-400 disabled:opacity-50 transition"
            >
              {loading ? '📤 Submitting...' : '✅ Submit Report'}
            </button>
          </form>
        </div>

        {chartData.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-gray-800 rounded-2xl p-6">
              <h2 className="text-xl font-bold mb-4">📊 Hours Tracked</h2>
              <div style={{ width: '100%', height: 250 }}>
                <ResponsiveContainer>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9CA3AF" fontSize={12} />
                    <YAxis stroke="#9CA3AF" fontSize={12} domain={[0, 20]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1F2937', border: '
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-gray-800 rounded-2xl6">
              <h2 className="text-xl font-bold mb-4">📈 Trend</h2>
              <div style={{ width: '100%', height: 250 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9CA3AF" fontSize={12} />
                    <YAxis stroke="#9CA3AF" fontSize={12} domain={[0, 20]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px', color: '#fff' }}
                    />
                    <ReferenceLine y={16} stroke="#EF4444" strokeDasharray="5 5" />
                    <Line type="monotone" dataKey="hours" stroke="#EAB308" strokeWidth={2} dot={{ fill: '#EAB308' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        <div className="bg-gray-800 rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">📋 Reports ({filteredReports.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">ON</th>
                  <th className="text-left p-3">:bg-gray-700/30">
                    <td className="p-3">{r.date}</td>
                    <td className="p-3">{r.lightOn}</td>
                    <td className="p-3">{r.lightOff}</td>
                    <td className="p-3 font-bold text-yellow-400">{r.durationHours}h</td>
                    <td className="p-3 text-gray-400">{r.reporterName}</td>
                    <td className="p-3 text-gray-500 max-w-[200px] truncate">{r.notes || '-'}</td>
                    <td className="p-3">
                      {parseFloat(r.durationHours) >= 16
                        ? <span className="text-green-400">✅</span>
                        : <span className="text-red-400">❌ -{(16 - r.durationHours).toFixed(1)}h</span>
                      }
                    </td>
                    {isAdmin && (
                      <td className="p-3">
                        <button
                          onClick={() => handleDeleteReport(r.id)}
                          className="bg-red-600 text-white px-3 py-1 rounded-lg text-xs font-bold hover:bg-red-500 transition"
                        >
                          🗑️ Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {showExport && (
          <div id="pdf-content" style={{ display: 'block', position: 'fixed', left: 0, top: 0, width: '100%', background: 'white', color: 'black', padding: 40, zIndex: 9999 }}>
            <div style={{ maxWidth: 800, margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
              <h1 style={{ textAlign: 'center', fontSize: 24 }}>>Total Reports: {totalReports}</p>
              <p>Week Average: {weekAvg} hours/day</p>
              
              <hr style={{ margin: '20px 0' }} />
              <h2>All Reports</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#333', color: 'white' }}>
                    <th style={{ padding: 8, border: '1px solid #555' }}>Date</th>
                    <th style={{ padding: 8, border: '1px solid #555' }}>ON</th>
                    <th style={{ padding: 8, border: '1px solid #555' }}>OFF</th>
                    <th style={{ padding: 8, border: '1px solid #555' }}>Hours</th>
                    <th style={{ padding: 8, border: '1px solid #555' }}>Reporter</th>
                    <th style={{ padding: 8, border: '1px solid #555' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredReportsForExport().map(r => (
                    <tr key={r.id}>
                      <td style={{ padding: 8, border: '1px solid #555' }}>{r.date}</td>
                      <td style={{ padding: 8, border: '1px solid #555' }}>{r.lightOn}</td>
                      <td style={{ padding: 8, border: '1px solid #555' }}>{r.lightOff}</td>
                      <td style={{ padding: 8, border: '1px solid #555' }}>{r.durationHours}h</td>
                      <td style={{ padding: 8, border: '1px solid #555' }}>{r.reporterName}</td>
                      <td style={{ padding: 8, border: '1px solid #555' }}>{r.notes || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
