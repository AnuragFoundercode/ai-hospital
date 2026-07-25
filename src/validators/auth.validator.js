const Joi = require('joi');

const sendOtpSchema = Joi.object({
  mobile: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
      'string.pattern.base': 'Please provide a valid 10-digit Indian mobile number',
    }),
});

const verifyOtpSchema = Joi.object({
  mobile: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .required(),
  otp: Joi.string()
    .length(6)
    .required(),
});

const registerSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).required(),
  mobile: Joi.string()
    .pattern(/^[6-9]\d{9}$/)
    .required(),
  email: Joi.string().email().optional(),
  role: Joi.string()
    .valid('patient', 'doctor', 'pharmacy', 'pathology', 'blood_bank', 'diagnostic_center', 'ambulance_driver', 'delivery_partner', 'sample_collector')
    .default('patient'),
});

module.exports = { sendOtpSchema, verifyOtpSchema, registerSchema };
