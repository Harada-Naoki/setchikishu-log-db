import { useState, useEffect } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import "../css/MachineList.css"; // CSS適用

function MachineList() {
  const [machines, setMachines] = useState([]);
  const navigate = useNavigate();
  const location = useLocation();

  const { storeName } = useParams();
  const decodedStoreName = decodeURIComponent(storeName);

  const queryParams = new URLSearchParams(location.search);
  const selectedCompetitor = queryParams.get("competitor");
  const selectedType = queryParams.get("type");

  const [selectedStore, setSelectedStore] = useState("");
  const [competitors, setCompetitors] = useState([]);
  const [typeOptions, setTypeOptions] = useState([]);
  const [pachinkoTypes, setPachinkoTypes] = useState([]);
  const [slotTypes, setSlotTypes] = useState([]);

  const [updatedDates, setUpdatedDates] = useState([]);
  const [selectedDate1, setSelectedDate1] = useState('');
  const [selectedDate2, setSelectedDate2] = useState('');

  const [selectedComparisonCompetitor, setSelectedComparisonCompetitor] = useState("");
  const [comparisonMachines, setComparisonMachines] = useState([]);
  const [showComparisonTable, setShowComparisonTable] = useState(true);
  const [comparisonCompetitorTitle, setComparisonCompetitorTitle] = useState("");
  const [CompetitorTitle, setCompetitorTitle] = useState("");


  const [sortConfig, setSortConfig] = useState({ key: '', direction: 'asc' });

  const API_URL = process.env.REACT_APP_API_URL; // 🌍 環境変数を適用

  /** 🔹 自店名を取得 */
  useEffect(() => {
    if (storeName) {
      setSelectedStore(decodeURIComponent(storeName));
    }
  }, [storeName]);

  /** 🔹 競合店リストを取得 */
  useEffect(() => {
    if (!API_URL || !selectedStore) return;

    fetch(`${API_URL}/get-stores`)
      .then(res => res.json())
      .then(data => {
        const store = data.find(s => s.name === selectedStore);
        setCompetitors(store ? store.competitors : []);
      })
      .catch(err => console.error("エラー:", err));
  }, [API_URL, selectedStore]);

  /** 🔹 種別リストを取得 */
  useEffect(() => {
    if (!API_URL) return;
  
    fetch(`${API_URL}/get-types`)
      .then(res => res.json())
      .then(data => {
        setTypeOptions(data);
        setPachinkoTypes(data.slice(0, 4));
        setSlotTypes(data.slice(4, 8));
      })
      .catch(err => console.error("エラー:", err));
  }, [API_URL]);

  /** 🔹 機種データを取得 */
  useEffect(() => {
    if (!API_URL || !decodedStoreName || !selectedCompetitor || !selectedType) return;
  
    fetch(`${API_URL}/get-machines?storeName=${decodedStoreName}&competitorName=${selectedCompetitor}&category=${selectedType}`)
    .then(res => res.json())
    .then(data => {
      const latestMap = new Map();
      (data.latest || []).forEach(machine => {
        latestMap.set(machine.machine_name, machine);
      });

      const previousMap = new Map();
      (data.previous || []).forEach(machine => {
        previousMap.set(machine.machine_name, machine);
      });

      const allMachineNames = Array.from(
        new Set([...latestMap.keys(), ...previousMap.keys()])
      );

      const mergedMachines = allMachineNames.map(name => {
        const latest = latestMap.get(name);
        const previous = previousMap.get(name);

        const quantity = latest ? latest.quantity : 0;
        const updated_at = latest ? latest.updated_at : "";
        const prevQuantity = previous ? previous.quantity : 0;
        const prevUpdatedAt = previous ? previous.updated_at : "";

        return {
          machine_name: name,
          quantity,
          formattedDate: updated_at ? new Date(updated_at).toISOString().split("T")[0] : "",
          prevQuantity,
          prevFormattedDate: prevUpdatedAt ? new Date(prevUpdatedAt).toISOString().split("T")[0] : "",
          difference: quantity - prevQuantity,
          isEditing: false,
          newQuantity: quantity,
        };
      });

      setMachines(mergedMachines);
    })
    .catch(err => {
      console.error("エラー:", err);
      setMachines([]); // エラー時も空配列をセット
    });
  }, [API_URL, decodedStoreName, selectedCompetitor, selectedType]);

  // 🔹 JST変換関数を追加
  const formatDateToJSTString = (dateStr) => {
    const date = new Date(dateStr);
    const jstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000)); // UTC → JST
    return jstDate.toISOString().slice(0, 19).replace('T', ' ');
  };

  const navigateWithParams = (competitor, type) => {
    const params = new URLSearchParams();
  
    if (competitor) params.set("competitor", competitor);
    if (type) params.set("type", type);
  
    navigate(`/machines/${encodeURIComponent(decodedStoreName)}?${params.toString()}`);
  }; 
  
  /** 🔹 更新日時の一覧を取得 */
  useEffect(() => {
    if (!API_URL || !decodedStoreName || !selectedCompetitor || !selectedType) return;

    const competitorParam = selectedCompetitor === "self" ? "self" : selectedCompetitor;

    fetch(`${API_URL}/get-updated-dates?storeName=${decodedStoreName}&competitorName=${competitorParam}&category=${selectedType}`)
      .then(res => res.json())
      .then(dates => {
        if (!Array.isArray(dates)) {
          console.error("❌ 無効なデータ形式:", dates);
          setUpdatedDates([]);
          setSelectedDate1('');
          setSelectedDate2('');
          return;
        }

        const jstDates = dates.map(date => formatDateToJSTString(date));
        setUpdatedDates(jstDates);
        setSelectedDate1(jstDates[0] || '');
        setSelectedDate2(jstDates[1] || '');
      })
      .catch(err => {
        console.error("❌ 更新日時取得エラー:", err);
        setUpdatedDates([]);
        setSelectedDate1('');
        setSelectedDate2('');
      });
  }, [API_URL, decodedStoreName, selectedCompetitor, selectedType]);

  /** 🔹 編集モードを切り替え */
  const toggleEdit = (index) => {
    setMachines(machines.map((machine, i) =>
      i === index ? { ...machine, isEditing: !machine.isEditing } : machine
    ));
  };

  /** 🔹 台数を変更 */
  const handleQuantityChange = (index, newValue) => {
    setMachines(machines.map((machine, i) =>
      i === index ? { ...machine, newQuantity: newValue } : machine
    ));
  };

  /** 🔹 台数を更新 */
  const updateQuantity = (index) => {
    const machine = machines[index];

    if (machine.newQuantity < 0) {
      alert("台数は0以上で入力してください");
      return;
    }

    const isOwnStore = selectedCompetitor === selectedStore;

    fetch(`${API_URL}/update-machine-quantity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeName: decodedStoreName,  // ✅ 自店登録の場合に必要
        machineName: machine.machine_name,
        competitorName: isOwnStore ? "self" : selectedCompetitor, // ✅ 自店なら "self"
        category: selectedType,
        quantity: machine.newQuantity
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          alert(`更新に失敗しました: ${data.error}`);
          return;
        }
        alert("台数を変更しました！");

        // ✅ UIを更新
        setMachines(machines.map((m, i) =>
          i === index ? { ...m, quantity: machine.newQuantity, isEditing: false } : m
        ));
      })
      .catch(err => {
        console.error("更新エラー:", err);
        alert("更新に失敗しました");
      });
  };

  const handleSort = (key) => {
    let direction = 'desc'; // 最初は降順に設定
    if (sortConfig.key === key) {
      direction = sortConfig.direction === 'desc' ? 'asc' : 'desc';
    }
    setSortConfig({ key, direction });
  
    const sortedMachines = [...machines].sort((a, b) => {
      let aValue = a[key];
      let bValue = b[key];
  
      if (key === 'difference') {
        aValue = Math.abs(aValue);
        bValue = Math.abs(bValue);
      }
  
      if (direction === 'asc') {
        return aValue - bValue;
      } else {
        return bValue - aValue;
      }
    });
  
    setMachines(sortedMachines);
  };  
  
  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? '▲' : '▼';
  };

  /** 🔹 更新日時から機種データを取得 */
  const handleApplyDates = () => {
    if (!selectedDate1 || !selectedDate2) {
      alert("両方の日付を選択してください");
      console.error("❌ 日付が未選択", { selectedDate1, selectedDate2 });
      return;
    }

    const isOwnStore = selectedCompetitor === "self"; // ✅ 自店判定
    const competitorParam = isOwnStore ? "self" : selectedCompetitor; // ✅ フロントエンドで適切に処理

    const url = `${API_URL}/get-machines-by-dates?storeName=${decodedStoreName}&competitorName=${competitorParam}&category=${selectedType}&date1=${selectedDate1}&date2=${selectedDate2}`;

    console.log("📡 リクエストURL:", url);

    fetch(url)
      .then(res => res.json())
      .then(data => {
        console.log("📥 受信データ:", data); // 受信データ全体をログ出力

        if (!data.date1 || !data.date2) {
          console.warn("❗ 受信データに日付データが不足", data);
          alert("データが取得できませんでした");
          return;
        }

        console.log("📆 データ（最新）:", data.date1);
        console.table(data.date1); // 最新データの詳細を表形式で出力
        console.log("📆 データ（比較対象）:", data.date2);
        console.table(data.date2); // 比較対象データの詳細を表形式で出力

        const latestMap = new Map();
        data.date1.forEach(machine => latestMap.set(machine.machine_name, machine));

        const previousMap = new Map();
        data.date2.forEach(machine => previousMap.set(machine.machine_name, machine));

        const allMachineNames = Array.from(new Set([...latestMap.keys(), ...previousMap.keys()]));

        const mergedMachines = allMachineNames.map(name => {
          const latest = latestMap.get(name);
          const previous = previousMap.get(name);

          const quantity = latest ? latest.quantity : 0;
          const updated_at = latest ? latest.updated_at : '';
          const prevQuantity = previous ? previous.quantity : 0;
          const prevUpdatedAt = previous ? previous.updated_at : '';

          return {
            machine_name: name,
            quantity,
            formattedDate: updated_at ? formatDateToJSTString(updated_at).split(' ')[0] : '',
            prevQuantity,
            prevFormattedDate: prevUpdatedAt ? formatDateToJSTString(prevUpdatedAt).split(' ')[0] : '',
            difference: quantity - prevQuantity,
            isEditing: false,
            newQuantity: quantity,
          };
        });

        console.log("📝 統合データ:", mergedMachines);
        console.table(mergedMachines); // 統合後のデータを表形式で出力

        setMachines(mergedMachines);
      })
      .catch(err => {
        console.error("❌ fetchエラー:", err);
        alert("データ取得中にエラーが発生しました");
      });
  };

  // 比較データ取得
  const fetchComparisonData = () => {
    if (!API_URL || !selectedCompetitor || !selectedComparisonCompetitor || !selectedType) {
      alert("比較する店舗と種別を選択してください");
      return;
    }
  
    const storeParam = encodeURIComponent(decodedStoreName);
    const competitorParam = encodeURIComponent(selectedCompetitor);
    const comparisonCompetitorParam = encodeURIComponent(selectedComparisonCompetitor);
    const categoryParam = encodeURIComponent(selectedType);
  
    const currentStoreURL = `${API_URL}/get-machines?storeName=${storeParam}&competitorName=${competitorParam}&category=${categoryParam}`;
    const comparisonStoreURL = `${API_URL}/get-machines?storeName=${storeParam}&competitorName=${comparisonCompetitorParam}&category=${categoryParam}`;
  
    Promise.all([
      fetch(currentStoreURL).then(res => res.json()),
      fetch(comparisonStoreURL).then(res => res.json())
    ])
    .then(([currentData, comparisonData]) => {
      const currentMap = new Map();
      (currentData.latest || []).forEach(machine => {
        currentMap.set(machine.machine_name, machine);
      });
  
      const comparisonMap = new Map();
      (comparisonData.latest || []).forEach(machine => {
        comparisonMap.set(machine.machine_name, machine);
      });
  
      // 両方の店舗の機種リストを統合
      const allMachineNames = Array.from(new Set([...currentMap.keys(), ...comparisonMap.keys()]));
  
      const mergedComparisonMachines = allMachineNames.map(name => {
        const current = currentMap.get(name);
        const comparison = comparisonMap.get(name);
  
        return {
          machine_name: name,
          currentQuantity: current ? current.quantity : 0,
          comparisonQuantity: comparison ? comparison.quantity : 0,
          difference: (current ? current.quantity : 0) - (comparison ? comparison.quantity : 0),
        };
      });
  
      setComparisonMachines(mergedComparisonMachines);
  
      // ✅ タイトルを更新（比較が適用されたときのみ）
      setCompetitorTitle(selectedCompetitor === "self" ? "自店" : selectedCompetitor);
      setComparisonCompetitorTitle(selectedComparisonCompetitor === "self" ? "自店" : selectedComparisonCompetitor);
    })
    .catch(err => {
      console.error("❌ 比較データ取得エラー:", err);
      alert("比較データの取得に失敗しました");
    });
  };
  
  return (
    <div className="machine-list-container">
      <h2>登録済みの機種一覧</h2>

      <div className="filter-container">
      <label>対象店舗を選択:</label>
        <select
          value={selectedCompetitor || ""}
          onChange={(e) => navigateWithParams(e.target.value, selectedType)}
        >
          <option value="">選択してください</option>

          {/* ✅ 自店を最初に追加 */}
          {selectedStore && (
            <option value="self">【自店】{selectedStore}</option>
          )}

          {/* 競合店リスト */}
          {competitors.map((store) => (
            <option key={store} value={store}>{store}</option>
          ))}
        </select>

        <label>種別:</label>
        <div className="type-group">
          <span className="type-group-title">【パチンコ】</span>
          <div className="type-options">
            {pachinkoTypes.map((t) => (
              <label key={t} className="type-option">
                <input
                  type="radio"
                  value={t}
                  checked={selectedType === t}
                  onChange={(e) => navigateWithParams(selectedCompetitor, e.target.value)}
                />
                {t}
              </label>
            ))}
          </div>
        </div>

        <div className="type-group">
          <span className="type-group-title">【スロット】</span>
          <div className="type-options">
            {slotTypes.map((t) => (
              <label key={t} className="type-option">
                <input
                  type="radio"
                  value={t}
                  checked={selectedType === t}
                  onChange={(e) => navigateWithParams(selectedCompetitor, e.target.value)}
                />
                {t}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="date-select-container">
        <label>比較する日付を選択:</label>
        <select value={selectedDate1} onChange={(e) => setSelectedDate1(e.target.value)}>
          {updatedDates.map(date => {
            const jstDate = formatDateToJSTString(date);
            return (
              <option key={date} value={jstDate}>
                {jstDate}
              </option>
            );
          })}
        </select>
        <span>と</span>
        <select value={selectedDate2} onChange={(e) => setSelectedDate2(e.target.value)}>
          {updatedDates.map(date => {
            const jstDate = formatDateToJSTString(date);
            return (
              <option key={date} value={jstDate}>
                {jstDate}
              </option>
            );
          })}
        </select>
        <button onClick={handleApplyDates}>適用</button>
      </div>

      <div className="store-compare-container">
        <h3>店舗間での比較</h3>
        <label>比較対象の店舗:</label>
        <select value={selectedComparisonCompetitor} onChange={(e) => setSelectedComparisonCompetitor(e.target.value)}>
          <option value="">選択してください</option>
          {selectedStore && <option value="self">【自店】{selectedStore}</option>}
          {competitors.map((store) => (
            <option key={store} value={store}>{store}</option>
          ))}
        </select>
        <button onClick={fetchComparisonData}>比較を適用</button>
      </div>

      {comparisonMachines.length > 0 && (
        <button 
          className="toggle-btn" 
          onClick={() => setShowComparisonTable(prev => !prev)}
        >
          {showComparisonTable ? "比較結果を隠す" : "比較結果を表示"}
        </button>
      )}

      {showComparisonTable && comparisonMachines.length > 0 && (() => {
          // 自店と比較対象の総台数を計算
          const totalCurrentQuantity = comparisonMachines.reduce((sum, machine) => sum + machine.currentQuantity, 0);
          const totalComparisonQuantity = comparisonMachines.reduce((sum, machine) => sum + machine.comparisonQuantity, 0);

          return (
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>機種名</th>
                  <th>
                  {CompetitorTitle || "比較対象"} 台数 ({totalCurrentQuantity})
                  </th>
                  <th>
                    {comparisonCompetitorTitle || "比較対象"} 台数 ({totalComparisonQuantity}) 
                  </th>
                  <th>差分</th>
                </tr>
              </thead>
              <tbody>
                {comparisonMachines.map((machine, index) => (
                  <tr key={index}>
                    <td>{machine.machine_name}</td>
                    <td>{machine.currentQuantity}</td>
                    <td>{machine.comparisonQuantity}</td>
                    <td style={{ color: machine.difference > 0 ? 'red' : machine.difference < 0 ? 'blue' : 'black' }}>
                      {machine.difference > 0 ? `+${machine.difference}` : machine.difference}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
      })()}

      {machines.length === 0 ? (
        <p className="no-data">データがありません</p>
      ) : (
        <table className="machine-table">
          <thead>
            <tr>
              <th>機種名</th>
              <th className="cansort" onClick={() => handleSort('quantity')}>
                台数
                <span className="sort-icon">{getSortIcon('quantity')}</span>
              </th>
              <th>更新日</th>
              <th className="cansort" onClick={() => handleSort('prevQuantity')}>
                前回台数
                <span className="sort-icon">{getSortIcon('prevQuantity')}</span>
              </th>
              <th>前回更新日</th>
              <th className="cansort" onClick={() => handleSort('difference')}>
                差分
                <span className="sort-icon">{getSortIcon('difference')}</span>
              </th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {machines.map((machine, index) => (
              <tr key={index}>
                <td>{machine.machine_name}</td>
                <td>
                  {machine.isEditing ? (
                    <input
                      type="number"
                      value={machine.newQuantity}
                      onChange={(e) => handleQuantityChange(index, e.target.value)}
                      className="quantity-input"
                    />
                  ) : (
                    machine.quantity
                  )}
                </td>
                <td>{machine.formattedDate}</td>
                <td>{machine.prevQuantity}</td>
                <td>{machine.prevFormattedDate}</td>
                <td>
                  {machine.difference > 0 && (
                    <span style={{ color: 'red' }}>↑ {machine.difference}</span>
                  )}
                  {machine.difference < 0 && (
                    <span style={{ color: 'blue' }}>↓ {Math.abs(machine.difference)}</span>
                  )}
                  {machine.difference === 0 && (
                    <span style={{ color: 'green' }}>→ 0</span>
                  )}
                </td>
                <td>
                  {machine.isEditing ? (
                    <>
                      <button className="save-btn" onClick={() => updateQuantity(index)}>保存</button>
                      <button className="cancel-btn" onClick={() => toggleEdit(index)}>キャンセル</button>
                    </>
                  ) : (
                    <button className="edit-btn" onClick={() => toggleEdit(index)}>編集</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="button-container">
        <div className="button-box" onClick={() => navigate(`/register/${encodeURIComponent(storeName)}`)}>
          <div className="icon">
            📝
          </div>
          <h3>機種登録画面へ</h3>
          <p>競合店舗の設置機種の登録を行う画面に移動します。</p>
        </div>

        <div className="button-box" onClick={() => navigate(`/updates/${encodeURIComponent(storeName)}`)}>
          <div className="icon">
            🔄
          </div>
          <h3>更新情報一覧へ</h3>
          <p>競合店のカテゴリごとの最新更新状況を確認する画面に移動します。</p>
        </div>
      </div>
      <button
        className="navigate-btn"
        onClick={() => navigate(`/select-store`)}
      >
        Topへ
      </button>
    </div>
  );
}

export default MachineList;
