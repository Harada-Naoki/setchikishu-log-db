import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { useState } from "react";
import Login from "./components/Login";
import SelectStore from "./components/SelectStore";
import MachineForm from "./components/MachineForm";
import MachineList from "./components/MachineList";
import SisSelect from "./components/SisSelectForm";
import UpdateInfo from "./components/UpdateInfo";

function App() {
  const [selectedStore, setSelectedStore] = useState("");

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/select-store" element={<SelectStore setSelectedStore={setSelectedStore} />} />
        <Route path="/register/:storeName" element={<MachineForm />} />
        <Route path="/machines/:storeName" element={<MachineList />} />
        <Route path="/updates/:storeName" element={<UpdateInfo />} />
        <Route path="/sis-select" element={<SisSelect/>} />
      </Routes>
    </Router>
  );
}

export default App;
