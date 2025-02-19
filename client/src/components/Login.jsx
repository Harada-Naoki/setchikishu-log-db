import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/MachineForm.css";

function Login() {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const handleLogin = (e) => {
    e.preventDefault();
    if (id === "shouei" && password === "pass1234") {
      navigate("/select-store"); // 認証成功 → 自店選択ページへ遷移
    } else {
      alert("IDまたはパスワードが違います");
    }
  };

  return (
    <div className="container">
      <h2>ログイン</h2>
      <form className="machine-form" onSubmit={handleLogin}>
        <label>ID:</label>
        <input type="text" value={id} onChange={(e) => setId(e.target.value)} required />

        <label>パスワード:</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

        <button type="submit" className="submit-btn">ログイン</button>
      </form>
    </div>
  );
}

export default Login;
