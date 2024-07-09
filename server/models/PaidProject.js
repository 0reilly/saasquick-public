const mongoose = require('mongoose');

const paidProjectSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    projectDescription: { type: String, required: false },
    projectType: { type: String, required: false },
    finished: { type: Boolean, default: false },
    paid: { type: Boolean, default: false },
    downloadUrl: { type: String, required: false },
    createdAt: { type: Date, default: Date.now },
});

const PaidProject = mongoose.model('PaidProject', paidProjectSchema);

module.exports = PaidProject;
