import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "../css/MachineList.css"; // CSS適用

function MachineList() {
  const [machines, setMachines] = useState([]);
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  const selectedStore = queryParams.get("store");
  const selectedCompetitor = queryParams.get("competitor");
  const selectedType = queryParams.get("type");

  const API_URL = process.env.REACT_APP_API_URL; // 🌍 環境変数を適用

  /** 🔹 機種データを取得 */
  useEffect(() => {
    if (!API_URL || !selectedStore || !selectedCompetitor || !selectedType) return;

    fetch(`${API_URL}/get-machines?storeName=${selectedStore}&competitorName=${selectedCompetitor}&category=${selectedType}`)
      .then(res => res.json())
      .then(data => setMachines(data.map(machine => ({
        ...machine,
        isEditing: false, // 🔹 編集モード
        newQuantity: machine.quantity, // 🔹 編集用の台数
        formattedDate: machine.updated_at ? new Date(machine.updated_at).toISOString().split("T")[0] : "" // 🔹 日付のみ取得
      }))))
      .catch(err => console.error("エラー:", err));
  }, [API_URL, selectedStore, selectedCompetitor, selectedType]);

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

    fetch(`${API_URL}/update-machine-quantity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machineName: machine.machine_name,
        competitorName: selectedCompetitor,
        category: selectedType,
        quantity: machine.newQuantity
      }),
    })
      .then(res => res.json())
      .then(data => {
        alert("台数を変更しました！");
        setMachines(machines.map((m, i) =>
          i === index ? { ...m, quantity: machine.newQuantity, isEditing: false } : m
        ));
      })
      .catch(err => {
        console.error("更新エラー:", err);
        alert("更新に失敗しました");
      });
  };

  return (
    <div className="machine-list-container">
      <h2>登録済みの機種一覧</h2>
      <button className="back-btn" onClick={() => navigate("/")}>← 登録画面へ戻る</button>

      {machines.length === 0 ? (
        <p className="no-data">データがありません</p>
      ) : (
        <table className="machine-table">
          <thead>
            <tr>
              <th>機種名</th>
              <th>台数</th>
              <th>更新日</th>
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
    </div>
  );
}

export default MachineList;
