import React, { useState, useEffect } from 'react';
import axios from 'axios';

const MachineForm = () => {
  const [machineType, setMachineType] = useState(""); // パチンコ or スロット (必須)
  const [makers, setMakers] = useState([]); // メーカーリスト
  const [selectedMaker, setSelectedMaker] = useState(""); // 選択されたメーカー
  const [types, setTypes] = useState([]); // 機種タイプリスト
  const [selectedType, setSelectedType] = useState(""); // 選択された機種タイプ
  const [machineName, setMachineName] = useState(""); // 機種名部分一致検索用
  const [machines, setMachines] = useState([]); // 取得した機種リスト

  // メーカーリスト取得
  useEffect(() => {
    axios.get('http://localhost:5000/get-sis-makers')
      .then(response => setMakers(response.data))
      .catch(error => console.error('メーカー取得エラー:', error));
  }, []);

  // 機種タイプリスト取得
  useEffect(() => {
    axios.get('http://localhost:5000/get-sis-types')
      .then(response => setTypes(response.data))
      .catch(error => console.error('機種タイプ取得エラー:', error));
  }, []);

  // 機種リスト取得
  const fetchMachines = () => {
    if (!machineType) {
      alert("種別を選択してください");
      return;
    }

    const category = machineType === "pachinko" ? 1 : 2;

    axios.get('http://localhost:5000/get-sis-machines', {
      params: {
        category,
        maker: selectedMaker || undefined,
        type: selectedType || undefined,
        machineName: machineName || undefined
      }
    })
      .then(response => setMachines(response.data))
      .catch(error => console.error('機種取得エラー:', error));
  };

  return (
    <div>
      <h2>機種検索フォーム</h2>

      {/* パチンコ or スロット (必須) */}
      <label>種別:</label>
      <select value={machineType} onChange={(e) => setMachineType(e.target.value)}>
        <option value="">選択してください</option>
        <option value="pachinko">パチンコ</option>
        <option value="slot">スロット</option>
      </select>

      {/* メーカー選択 (任意) */}
      <label>メーカー:</label>
      <select value={selectedMaker} onChange={(e) => setSelectedMaker(e.target.value)}>
        <option value="">すべてのメーカー</option>
        {makers.map(maker => (
          <option key={maker.sis_maker_code} value={maker.sis_maker_code}>
            {maker.sis_maker_name}
          </option>
        ))}
      </select>

      {/* 機種タイプ選択 (任意) */}
      <label>機種タイプ:</label>
      <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
        <option value="">すべての機種タイプ</option>
        {types.map(type => (
          <option key={type.sis_type_code} value={type.sis_type_code}>
            {type.sis_type_name}
          </option>
        ))}
      </select>

      {/* 機種名部分一致検索 (任意) */}
      <label>機種名検索:</label>
      <input
        type="text"
        placeholder="例: 花火"
        value={machineName}
        onChange={(e) => setMachineName(e.target.value)}
      />

      {/* 機種検索ボタン */}
      <button onClick={fetchMachines}>機種を検索</button>

      {/* 機種リスト */}
      <h3>検索結果:</h3>
      <ul>
        {machines.length > 0 ? (
          machines.map((machine, index) => (
            <li key={index}>{machine.sis_machine_name}</li>
          ))
        ) : (
          <p>該当する機種がありません</p>
        )}
      </ul>
    </div>
  );
};

export default MachineForm;
