import React, {useEffect, useState} from 'react';
import { Router, Link } from '@reach/router';
import LandingPage from './pages/LandingPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailsPage from './pages/ProjectDetailsPage';

function App() {
    const [selectedProjectId, setSelectedProjectId] = useState(null);

    useEffect(() => {
        const storedSelectedProjectId = localStorage.getItem('selectedProjectId');
        if (storedSelectedProjectId) {
            setSelectedProjectId(storedSelectedProjectId);
        }


    }, []);

    const handleProjectSelect = (projectId) => {
        setSelectedProjectId(projectId);
        localStorage.setItem('selectedProjectId', projectId);
    };

    return (
        <Router>
            <LandingPage path="/" />
            <ProjectsPage path="/projects" handleProjectSelect={handleProjectSelect} />
            <ProjectDetailsPage path="/edit" selectedProjectId={selectedProjectId} />
        </Router>
    );
}

export default App;
