import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { navigate } from '@reach/router';
import { motion, AnimatePresence } from 'framer-motion';

const LandingPage = () => {
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showRegisterForm, setShowRegisterForm] = useState(false);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (token) {
            navigate('/projects');
        }
    }, []);

    const handleRegister = async (e) => {
        e.preventDefault();
        try {
            const response = await axios.post('/register', {
                username: e.target.username.value,
                password: e.target.password.value,
            });
            console.log(response.data.message);
            loginAfterRegister(e.target.username.value, e.target.password.value);
        } catch (error) {
            console.error('Registration error:', error);
        }
    };

    const loginAfterRegister = async (username, password) => {
        try {
            const response = await axios.post('/login', { username, password });
            const { token } = response.data;
            localStorage.setItem('token', token);
            navigate('/projects');
        } catch (error) {
            console.error('Login error:', error);
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            const response = await axios.post('/login', {
                username: e.target.username.value,
                password: e.target.password.value,
            });
            const { token } = response.data;
            localStorage.setItem('token', token);
            navigate('/projects');
        } catch (error) {
            console.error('Login error:', error);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col min-h-screen bg-white text-gray-900"
        >
            <header className="border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                    <motion.h1
                        initial={{ y: -20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="text-2xl font-semibold flex items-center"
                    >
                        SaaS Quick
                        <span className="bg-blue-100 text-blue-600 ml-2 px-2 py-1 rounded-full text-xs font-normal">Beta</span>
                    </motion.h1>
                    <nav>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => {
                                setShowAuthModal(true);
                                setShowRegisterForm(true);
                            }}
                            className="bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-300 mr-2"
                        >
                            Get Started
                        </motion.button>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => {
                                setShowAuthModal(true);
                                setShowRegisterForm(false);
                            }}
                            className="bg-gray-100 text-gray-900 px-4 py-2 rounded-full hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors duration-300"
                        >
                            Login
                        </motion.button>
                    </nav>
                </div>
            </header>

            <main className="flex-grow">
                <section className="py-20">
                    <div className="container mx-auto px-4">
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            className="text-center"
                        >
                            <h2 className="text-5xl font-bold mb-6">Build Your App 10x Faster</h2>
                            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
                                Stop wasting weeks on setup and boilerplate. SaasQuick generates your entire codebase in minutes, so you can focus on what really matters - your unique features and customers.
                            </p>
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => {
                                    setShowAuthModal(true);
                                    setShowRegisterForm(true);
                                }}
                                className="bg-blue-500 text-white font-semibold py-3 px-8 rounded-full hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-300 text-lg"
                            >
                                Start Building Now
                            </motion.button>
                        </motion.div>
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.6 }}
                            className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-16"
                        >
                            <div className="bg-gray-50 p-6 rounded-2xl shadow-lg">
                                <h3 className="text-2xl font-semibold mb-4">AI-Powered Development</h3>
                                <ul className="space-y-2 text-gray-600">
                                    <li>• Harness advanced AI for intelligent code generation</li>
                                    <li>• Get optimized, production-ready code tailored to your specific needs</li>
                                    <li>• Benefit from continuous learning and improvements based on user feedback</li>
                                </ul>
                            </div>
                            <div className="bg-gray-50 p-6 rounded-2xl shadow-lg">
                                <h3 className="text-2xl font-semibold mb-4">Accelerate Your Launch</h3>
                                <ul className="space-y-2 text-gray-600">
                                    <li>• Slash development time from months to days</li>
                                    <li>• Eliminate tedious setup and boilerplate coding</li>
                                    <li>• Focus on your unique features and get to market faster</li>
                                </ul>
                            </div>
                        </motion.div>
                    </div>
                </section>

                <section className="py-20 bg-gray-50">
                    <div className="container mx-auto px-4">
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.8 }}
                            className="text-center"
                        >
                            <h2 className="text-4xl font-bold mb-6">How SaasQuick Transforms Your Workflow</h2>
                            <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto">
                                Experience the future of app development. Our streamlined process takes you from idea to fully functional app in three simple steps.
                            </p>
                        </motion.div>
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 1 }}
                            className="grid grid-cols-1 md:grid-cols-3 gap-8"
                        >
                            {[
                                { title: "Describe Your App", description: "Tell us about your app's features, target audience, and goals. Our AI understands and adapts to your unique vision." },
                                { title: "AI Generates Your App", description: "Watch as our advanced AI creates a complete, customized codebase for your app in minutes." },
                                { title: "Launch and Iterate", description: "Get your functional app immediately. Easily modify and expand your project as needed using our intuitive interface." }
                            ].map((step, index) => (
                                <div key={index} className="text-center bg-white p-6 rounded-2xl shadow-lg">
                                    <div className="bg-blue-500 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                                        <span className="text-2xl font-bold text-white">{index + 1}</span>
                                    </div>
                                    <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                                    <p className="text-gray-600">
                                        {step.description}
                                    </p>
                                </div>
                            ))}
                        </motion.div>
                    </div>
                </section>
                <section className="py-20">
                    <div className="container mx-auto px-4">
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 1.2 }}
                            className="text-center"
                        >
                            <h2 className="text-4xl font-bold mb-6">Join the App Development Revolution</h2>
                            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
                                Don't let technical barriers hold you back. With SaasQuick, you can bring your app ideas to life faster than ever. Start building today and experience the future of development.
                            </p>
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => {
                                    setShowAuthModal(true);
                                    setShowRegisterForm(true);
                                }}
                                className="bg-blue-500 text-white font-semibold py-3 px-8 rounded-full hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-300 text-lg"
                            >
                                Start Building for $29
                            </motion.button>
                            <p className="mt-4 text-gray-500">Only $29 per project. No subscription required.</p>
                        </motion.div>
                    </div>
                </section>
            </main>

            <footer className="bg-gray-100 py-8">
                <div className="container mx-auto px-4 text-center">
                    <p className="text-gray-600">&copy; {new Date().getFullYear()} SaasQuick. Revolutionizing App Development.</p>
                </div>
            </footer>

            <AnimatePresence>
                {showAuthModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
                    >
                        <motion.div
                            initial={{ y: 50, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 50, opacity: 0 }}
                            className="bg-white rounded-2xl p-8 max-w-md w-full shadow-xl"
                        >
                            {showRegisterForm ? (
                                <form onSubmit={handleRegister} className="space-y-4">
                                    <h2 className="text-2xl font-bold mb-4">Create Your Account</h2>
                                    <input
                                        type="text"
                                        name="username"
                                        placeholder="Username"
                                        required
                                        className="w-full px-3 py-2 bg-gray-100 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-300"
                                    />
                                    <input
                                        type="password"
                                        name="password"
                                        placeholder="Password"
                                        required
                                        className="w-full px-3 py-2 bg-gray-100 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-300"
                                    />
                                    <div className="flex justify-between items-center">
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            type="submit"
                                            className="bg-blue-500 text-white font-semibold py-2 px-4 rounded-full hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-300"
                                        >
                                            Create Account
                                        </motion.button>
                                        <button
                                            type="button"
                                            onClick={() => setShowRegisterForm(false)}
                                            className="text-blue-500 hover:text-blue-600 transition-colors duration-300"
                                        >
                                            Already have an account? Login
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <form onSubmit={handleLogin} className="space-y-4">
                                    <h2 className="text-2xl font-bold mb-4">Welcome Back</h2>
                                    <input
                                        type="text"
                                        name="username"
                                        placeholder="Username"
                                        required
                                        className="w-full px-3 py-2 bg-gray-100 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-300"
                                    />
                                    <input
                                        type="password"
                                        name="password"
                                        placeholder="Password"
                                        required
                                        className="w-full px-3 py-2 bg-gray-100 text-gray-900 border border-gray-300 rounded-lg focus:outline-none focus:ring-2
focus:ring-blue-500 focus:border-blue-500 transition-colors duration-300"
                                    />
                                    <div className="flex justify-between items-center">
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            type="submit"
                                            className="bg-blue-500 text-white font-semibold py-2 px-4 rounded-full hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-300"
                                        >
                                            Login
                                        </motion.button>
                                        <button
                                            type="button"
                                            onClick={() => setShowRegisterForm(true)}
                                            className="text-blue-500 hover:text-blue-600 transition-colors duration-300"
                                        >
                                            New user? Create account
                                        </button>
                                    </div>
                                </form>
                            )}
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                className="mt-6 w-full bg-gray-100 text-gray-900 font-semibold py-2 px-4 rounded-full hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 transition-colors duration-300"
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

export default LandingPage;
