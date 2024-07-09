import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import { navigate } from '@reach/router';
import { motion, AnimatePresence } from 'framer-motion';

const ProjectsPage = ({ handleProjectSelect }) => {
    const [projectDescription, setProjectDescription] = useState('');
    const [projectType, setProjectType] = useState('web');
    const [progress, setProgress] = useState(0);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isComplete, setIsComplete] = useState(false);
    const socketRef = useRef(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadReady, setDownloadReady] = useState(false);
    const [userId, setUserId] = useState(null);
    const [showRegisterForm, setShowRegisterForm] = useState(false);
    const [user, setUser] = useState(null);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [hasPaid, setHasPaid] = useState(false);
    const [projects, setProjects] = useState([]);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [fileResponse, setFileResponse] = useState(null);
    const [project, setProject] = useState(null);
    const [selectedProjectId, setSelectedProjectId] = useState(null);
    const [downloadUrl, setDownloadUrl] = useState(null);
    const [projectToDelete, setProjectToDelete] = useState(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteConfirmation, setDeleteConfirmation] = useState('');

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (token) {
            console.log('Token found:', token);
            fetchUserData(token);
        } else {
            setIsLoading(false);
        }
        const userIdFromStorage = localStorage.getItem('userId');
        if (userIdFromStorage) {
            console.log('User ID found:', userIdFromStorage);
            setUserId(userIdFromStorage);
        }
    }, []);

    useEffect(() => {
        console.log('Selected project ID:', selectedProjectId)
        const fetchProject = async () => {
            try {
                const response = await axios.get(`/api/projects/${selectedProjectId}`, {
                    headers: {
                        Authorization: `${localStorage.getItem('token')}`,
                    },
                });

                console.log('Project:', response.data);
                console.log('hasPaid:', hasPaid)

                setProject(response.data);
                setProjectDescription(response.data.projectDescription);
                setProjectType(response.data.projectType);
                const finished = response.data.finished;
                console.log('Finished:', finished)
                if (finished) {
                    setProgress(100);
                    setDownloadUrl(response.data.downloadUrl);
                    setIsComplete(true)
                    setDownloadReady(true);
                } else {
                    setDownloadReady(false);
                    setIsComplete(false);
                }
            } catch (error) {
                console.error('Error fetching project:', error);
            }
        };

        if (selectedProjectId) {
            fetchProject();
        }
    }, [selectedProjectId]);

    useEffect(() => {
        if (user) {
            console.log('User logged in:', user);
            setUserId(user.id);
            setShowAuthModal(false);
            setShowProfileModal(false);
        }
    }, [user, userId]);

    const fetchUserData = async (token) => {
        try {
            const response = await axios.get('/user', {
                headers: {
                    Authorization: token,
                },
            });
            setUser(response.data.user);
            setIsLoading(false);
        } catch (error) {
            setIsLoading(false);
            console.error('Error fetching user data:', error);
        }
    };

    useEffect(() => {
        const fetchProjects = async () => {
            try {
                const response = await axios.get('/api/projects', {
                    headers: {
                        Authorization: `${localStorage.getItem('token')}`,
                    },
                });
                console.log('Projects:', response.data)
                setProjects(response.data);
            } catch (error) {
                console.error('Error fetching projects:', error);
            }
        };

        fetchProjects();
    }, [userId]);

    useEffect(() => {
        const token = localStorage.getItem('token');
        const setupWebSocket = () => {
            const socket = io('/', {
                auth: {
                    token: token,
                },
            });
            socketRef.current = socket;

            socket.on('progress_update', (data) => {
                setProgress(Math.floor(data.progress));
                console.log(`Progress update: ${data.progress}`);
            });

            socket.on('project_generated', (data) => {
                console.log('Project generation completed', data);
                setIsComplete(true);
                setDownloadReady(true);
                setHasPaid(false)
            });

            socket.on('user_login', (data) => {
                console.log('User logged in:', data);
                setUserId(data.userId);
                localStorage.setItem('userId', data.userId);
            });

            socket.on('payment_completed', (userId) => {
                console.log('Payment completed for user:', userId);
                setHasPaid(true);
                setShowPaymentModal(false);
            });

            return () => {
                socket.disconnect();
            };
        };

        setupWebSocket();

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, [userId]);

    useEffect(() => {
        if (hasPaid) {
            console.log('User has paid');
            setShowPaymentModal(false);
        }
    }, [hasPaid]);

    useEffect(() => {
        if (downloadUrl) {
            setIsComplete(true)
            setDownloadReady(true);
            console.log('Download URL:', downloadUrl);
        }
    }, [downloadUrl])

    const handleProjectClick = (projectId) => {
        handleProjectSelect(projectId);
        navigate(`/edit`);
    };

    const handleNewProject = async () => {
        try {
            const response = await axios.post(
                '/api/projects',
                {
                    projectDescription: '',
                    projectType: 'web',
                    userId,
                },
                {
                    headers: {
                        Authorization: `${localStorage.getItem('token')}`,
                    },
                }
            );

            const newProjectId = response.data._id;
            handleProjectSelect(newProjectId);
            setProjectDescription('');
            setProjectType('web');
            setProgress(0);
            setIsComplete(false);
            setDownloadReady(false);
            setDownloadUrl(null);
            setHasPaid(false);
            navigate(`/edit`);
        } catch (error) {
            console.error('Error creating new project:', error);
        }
    };

    const handleSubmit = async (e) => {
        if (e) {
            e.preventDefault();
        }

        setIsGenerating(true);

        console.log('calling build with project description:', projectDescription, 'projectType:', projectType, 'userId:', userId, 'projectId', selectedProjectId);
        try {
            const response = await axios.post(
                '/build',
                {
                    projectId: selectedProjectId,
                    projectDescription,
                    projectType,
                    userId,
                },
                {
                    headers: {
                        Authorization: localStorage.getItem('token'),
                    },
                }
            );

            console.log(response.data.message);
        } catch (error) {
            console.error('Error:', error);
        }
    };

    const handleRegister = (e) => {
        e.preventDefault();
        axios.post('/register', {
            username: e.target.username.value,
            password: e.target.password.value,
        })
            .then((response) => {
                console.log(response.data.message);
            })
            .catch((error) => {
                console.error('Registration error:', error);
            });
    };

    const handleLogin = (e) => {
        e.preventDefault();
        axios.post('/login', {
            username: e.target.username.value,
            password: e.target.password.value,
        })
            .then((response) => {
                const { token } = response.data;
                console.log('Login successful:', token)
                localStorage.setItem('token', token);
                fetchUserData(token);
                setShowAuthModal(false);
            })
            .catch((error) => {
                console.error('Login error:', error);
            });
    };

    const handleDownload = async () => {
        try {
            setIsDownloading(true);
            if (!downloadUrl) {
                const response = await axios.get(`/download/${selectedProjectId}`, {
                    headers: {
                        Authorization: localStorage.getItem('token'),
                    },
                });

                const url = response.data.downloadUrl;
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', 'project.zip');
                document.body.appendChild(link);
                link.click();
                link.remove();
                setIsDownloading(false);
            } else {
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.setAttribute('download', 'project.zip');
                document.body.appendChild(link);
                link.click();
                link.remove();
                setIsDownloading(false);
            }
        } catch (error) {
            console.error('Error downloading project:', error);
            setIsDownloading(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        setUser(null);
        navigate('/');
    };

    const handleDeleteClick = (project) => {
        setProjectToDelete(project);
        setShowDeleteModal(true);
    };

    const handleDeleteConfirmation = async () => {
        try {
            await axios.delete(`/api/projects/${projectToDelete._id}`, {
                headers: {
                    Authorization: localStorage.getItem('token'),
                },
            });
            setProjects(projects.filter((project) => project._id !== projectToDelete._id));
            setShowDeleteModal(false);
            setProjectToDelete(null);
        } catch (error) {
            console.error('Error deleting project:', error);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
                backgroundColor: 'white',
                minHeight: '100vh',
                color: '#1a202c'
            }}
        >
            <header style={{
                borderBottom: '1px solid #e2e8f0'
            }}>
                <div style={{
                    maxWidth: '80rem',
                    margin: '0 auto',
                    padding: '1rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <motion.h1
                        initial={{ y: -20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        style={{
                            fontSize: '1.5rem',
                            fontWeight: '600'
                        }}
                    >
                        SaaS Quick
                    </motion.h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        {isLoading ? (
                            <div style={{
                                height: '2rem',
                                width: '2rem',
                                borderRadius: '50%',
                                border: '4px solid #3b82f6',
                                borderTopColor: 'transparent',
                                animation: 'spin 1s linear infinite'
                            }}></div>
                        ) : user ? (
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={handleLogout}
                                style={{
                                    backgroundColor: '#3b82f6',
                                    color: 'white',
                                    padding: '0.5rem 1rem',
                                    borderRadius: '9999px',
                                    fontWeight: '500',
                                    transition: 'all 300ms',
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                Logout
                            </motion.button>
                        ) : (
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setShowAuthModal(true)}
                                style={{
                                    backgroundColor: '#3b82f6',
                                    color: 'white',
                                    padding: '0.5rem 1rem',
                                    borderRadius: '9999px',
                                    fontWeight: '500',
                                    transition: 'all 300ms',
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                            >
                                Login/Register
                            </motion.button>
                        )}
                    </div>
                </div>
            </header>

            <main style={{
                maxWidth: '80rem',
                margin: '0 auto',
                padding: '3rem 1rem'
            }}>
                <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    style={{
                        backgroundColor: 'white',
                        borderRadius: '1rem',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                        padding: '1.5rem',
                        transition: 'all 300ms'
                    }}
                >
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '1.5rem'
                    }}>
                        <h2 style={{
                            fontSize: '1.5rem',
                            fontWeight: '600',
                            color: '#1a202c'
                        }}>Your Projects</h2>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={handleNewProject}
                            style={{
                                backgroundColor: '#3b82f6',
                                color: 'white',
                                padding: '0.5rem 1rem',
                                borderRadius: '9999px',
                                fontWeight: '500',
                                transition: 'all 300ms',
                                border: 'none',
                                cursor: 'pointer'
                            }}
                        >
                            New Project
                        </motion.button>
                    </div>
                    {projects.length > 0 ? (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {projects.map((project) => (
                                <motion.li
                                    key={project._id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    style={{
                                        backgroundColor: '#f7fafc',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '0.75rem',
                                        padding: '1rem',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: '1rem'
                                    }}
                                >
                                    <div style={{ flexGrow: 1, marginRight: '1rem', overflow: 'hidden' }}>
                                        <motion.button
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            onClick={() => handleProjectClick(project._id)}
                                            style={{
                                                fontSize: '1.125rem',
                                                fontWeight: '600',
                                                color: '#1a202c',
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                                width: '100%',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            {project.projectDescription || 'Untitled Project'}
                                        </motion.button>
                                        <p style={{
                                            fontSize: '0.875rem',
                                            color: '#718096',
                                            marginTop: '0.25rem',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap'
                                        }}>Created on: {new Date(project.createdAt).toLocaleString()}</p>
                                    </div>
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => handleDeleteClick(project)}
                                        style={{
                                            backgroundColor: '#f56565',
                                            color: 'white',
                                            padding: '0.5rem 1rem',
                                            borderRadius: '9999px',
                                            fontWeight: '500',
                                            transition: 'all 300ms',
                                            border: 'none',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Delete
                                    </motion.button>
                                </motion.li>
                            ))}
                        </ul>
                    ) : (
                        <p style={{ color: '#718096' }}>No projects found.</p>
                    )}
                </motion.div>
            </main>

            <AnimatePresence>
                {showDeleteModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 50,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(0, 0, 0, 0.5)'
                        }}
                    >
                        <motion.div
                            initial={{ y: 50, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 50, opacity: 0 }}
                            style={{
                                backgroundColor: 'white',
                                borderRadius: '1rem',
                                padding: '2rem',
                                maxWidth: '28rem',
                                width: '100%',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
                            }}
                        >
                            <h2 style={{
                                fontSize: '1.5rem',
                                fontWeight: '700',
                                marginBottom: '1rem',
                                color: '#1a202c'
                            }}>Delete Project</h2>
                            <p style={{
                                color: '#4a5568',
                                marginBottom: '1rem'
                            }}>
                                Type the project name to confirm deletion:
                            </p>
                            <input
                                type="text"
                                style={{
                                    width: '100%',
                                    padding: '0.5rem 0.75rem',
                                    backgroundColor: '#f7fafc',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '0.375rem',
                                    marginBottom: '1rem',
                                    color: '#4a5568'
                                }}
                                placeholder="Project name"
                                value={projectToDelete?.projectDescription || 'Untitled Project'}
                                readOnly
                            />
                            <input
                                type="text"
                                style={{
                                    width: '100%',
                                    padding: '0.5rem 0.75rem',
                                    backgroundColor: '#f7fafc',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '0.375rem',
                                    marginBottom: '1rem',
                                    color: '#4a5568'
                                }}
                                placeholder="Type project name here"
                                onChange={(e) => setDeleteConfirmation(e.target.value)}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={handleDeleteConfirmation}
                                    disabled={deleteConfirmation !== (projectToDelete?.projectDescription || 'Untitled Project')}
                                    style={{
                                        backgroundColor: '#f56565',
                                        color: 'white',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '9999px',
                                        fontWeight: '500',
                                        transition: 'all 300ms',
                                        border: 'none',
                                        cursor: 'pointer',
                                        opacity: deleteConfirmation !== (projectToDelete?.projectDescription || 'Untitled Project') ? '0.5' : '1',
                                        pointerEvents: deleteConfirmation !== (projectToDelete?.projectDescription || 'Untitled Project') ? 'none' : 'auto'
                                    }}
                                >
                                    Delete
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => setShowDeleteModal(false)}
                                    style={{
                                        backgroundColor: '#e2e8f0',
                                        color: '#4a5568',
                                        padding: '0.5rem 1rem',
                                        borderRadius: '9999px',
                                        fontWeight: '500',
                                        transition: 'all 300ms',
                                        border: 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Cancel
                                </motion.button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}

                {showAuthModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 50,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(0, 0, 0, 0.5)'
                        }}
                    >
                        <motion.div
                            initial={{ y: 50, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 50, opacity: 0 }}
                            style={{
                                backgroundColor: 'white',
                                borderRadius: '1rem',
                                padding: '2rem',
                                maxWidth: '28rem',
                                width: '100%',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
                            }}
                        >
                            {showRegisterForm ? (
                                <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <h2 style={{
                                        fontSize: '1.5rem',
                                        fontWeight: '700',
                                        marginBottom: '1rem',
                                        color: '#1a202c'
                                    }}>Create Your Account</h2>
                                    <input
                                        type="text"
                                        name="username"
                                        placeholder="Username"
                                        required
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem 0.75rem',
                                            backgroundColor: '#f7fafc',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '0.375rem',
                                            color: '#4a5568'
                                        }}
                                    />
                                    <input
                                        type="password"
                                        name="password"
                                        placeholder="Password"
                                        required
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem 0.75rem',
                                            backgroundColor: '#f7fafc',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '0.375rem',
                                            color: '#4a5568'
                                        }}
                                    />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            type="submit"
                                            style={{
                                                backgroundColor: '#3b82f6',
                                                color: 'white',
                                                padding: '0.5rem 1rem',
                                                borderRadius: '9999px',
                                                fontWeight: '500',
                                                transition: 'all 300ms',
                                                border: 'none',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Create Account
                                        </motion.button>
                                        <button
                                            type="button"
                                            onClick={() => setShowRegisterForm(false)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: '#3b82f6',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Already have an account? Login
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <h2 style={{
                                        fontSize: '1.5rem',
                                        fontWeight: '700',
                                        marginBottom: '1rem',
                                        color: '#1a202c'
                                    }}>Welcome Back</h2>
                                    <input
                                        type="text"
                                        name="username"
                                        placeholder="Username"
                                        required
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem 0.75rem',
                                            backgroundColor: '#f7fafc',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '0.375rem',
                                            color: '#4a5568'
                                        }}
                                    />
                                    <input
                                        type="password"
                                        name="password"
                                        placeholder="Password"
                                        required
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem 0.75rem',
                                            backgroundColor: '#f7fafc',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '0.375rem',
                                            color: '#4a5568'
                                        }}
                                    />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            type="submit"
                                            style={{
                                                backgroundColor: '#3b82f6',
                                                color: 'white',
                                                padding: '0.5rem 1rem',
                                                borderRadius: '9999px',
                                                fontWeight: '500',
                                                transition: 'all 300ms',
                                                border: 'none',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Login
                                        </motion.button>
                                        <button
                                            type="button"
                                            onClick={() => setShowRegisterForm(true)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: '#3b82f6',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            New user? Create account
                                        </button>
                                    </div>
                                </form>
                            )}
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                style={{
                                    marginTop: '1.5rem',
                                    width: '100%',
                                    backgroundColor: '#f7fafc',
                                    color: '#4a5568',
                                    padding: '0.5rem 1rem',
                                    borderRadius: '9999px',
                                    fontWeight: '600',
                                    transition: 'all 300ms',
                                    border: 'none',
                                    cursor: 'pointer'
                                }}
                                onClick={() => setShowAuthModal(false)}
                            >
                                Close
                            </motion.button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default ProjectsPage;
