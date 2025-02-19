import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { useState } from "react";
import Login from "./components/Login";
import SelectStore from "./components/SelectStore";
import MachineForm from "./components/MachineForm";
import MachineList from "./components/MachineList";

function App() {
  const [selectedStore, setSelectedStore] = useState("");

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/select-store" element={<SelectStore setSelectedStore={setSelectedStore} />} />
        <Route path="/register" element={<MachineForm selectedStore={selectedStore} />} />
        <Route path="/machines" element={<MachineList />} />
      </Routes>
    </Router>
  );
}

export default App;
