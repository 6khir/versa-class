const Joi = require('joi');

const schemas = {
  project: Joi.object({
    title: Joi.string().min(3).max(100).required(),
    format: Joi.string().valid('A4', 'Letter').required(),
    tags: Joi.array().items(Joi.string()).max(10),
    description: Joi.string().max(1000),
  }),
  
  apiCall: Joi.object({
    service: Joi.string().valid('chatgpt', 'gemini', 'meta').required(),
    prompt: Joi.string().min(1).max(5000).required(),
    parameters: Joi.object(),
  }),
  
  credential: Joi.object({
    account: Joi.string().required(),
    password: Joi.string().min(8).required(),
  }),
};

class Validators {
  static validateProject(data) {
    const { error, value } = schemas.project.validate(data);
    if (error) throw new Error(`Validation failed: ${error.message}`);
    return value;
  }
  
  static validateApiCall(data) {
    const { error, value } = schemas.apiCall.validate(data);
    if (error) throw new Error(`Validation failed: ${error.message}`);
    return value;
  }
  
  static validateCredential(data) {
    const { error, value } = schemas.credential.validate(data);
    if (error) throw new Error(`Validation failed: ${error.message}`);
    return value;
  }

  static validateBody(validatorFn) {
    return (req, res, next) => {
      try {
        req.validatedBody = validatorFn(req.body);
        next();
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    };
  }
}

Validators.schemas = schemas;
module.exports = Validators;
