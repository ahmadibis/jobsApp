const Job = require('../models/Job')
const { StatusCodes } = require('http-status-codes')
const { BadRequestError, NotFoundError } = require('../errors')
const moment = require("moment");
const mongoose = require("mongoose");

const getAllJobs = async (req, res) => {
  const { search, status, jobType, sort } = req.query;

  // protected route 
  //in order to be able to filter by many criterias
  //always ensure you are searching based on the authenticated user

  const queryObject = {
    createdBy: req.user.userId,
  };

  //these are ways we could setup our data from frontend so if we provide it from frontend 
  //so we will define what we would be accepting from our re.query  i.e query parameters
  //and we can check and use it to build an object we can use to search 
  if (search) {
    queryObject.position = { $regex: search, $options: "i" };
  }
  // add stuff based on condition

  if (status && status !== "all") {
    queryObject.status = status;
  }
  if (jobType && jobType !== "all") {
    queryObject.jobType = jobType;
  }

  console.log(req.query)

  // NO AWAIT
    //remember we dont use await directly when we are trying to have to filter through or sort or paginate
  // since we will chain other properties form the model after we get the resources
  let result = Job.find(queryObject);

  // chain sort conditions

  //so these are the values coming from front end through the enums so we can use it to sort our 
  //data coming from db if they macth 
  if (sort === "latest") {
    result = result.sort("-createdAt");
  }
  if (sort === "oldest") {
    result = result.sort("createdAt");
  }
  if (sort === "a-z") {
    result = result.sort("position");
  }
  if (sort === "z-a") {
    result = result.sort("-position");
  }

  //

  // setup pagination
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  result = result.skip(skip).limit(limit);

  const jobs = await result;

  //returns the total jobs based on the query 
  const totalJobs = await Job.countDocuments(queryObject);
  //say totaljobs = 25 , limit = 10, that is 3 pages
  const numOfPages = Math.ceil(totalJobs / limit);

  res.status(StatusCodes.OK).json({ jobs, totalJobs, numOfPages });
};

const getJob = async (req, res) => {
  const {
    user: { userId },
    params: { id: jobId },
  } = req

  const job = await Job.findOne({
    _id: jobId,
    createdBy: userId,
  })
  if (!job) {
    throw new NotFoundError(`No job with id ${jobId}`)
  }
  res.status(StatusCodes.OK).json({ job })
}

const createJob = async (req, res) => {
  req.body.createdBy = req.user.userId
  const job = await Job.create(req.body)
  res.status(StatusCodes.CREATED).json({ job })
}

const updateJob = async (req, res) => {
  const {
    body: { company, position },
    user: { userId },
    params: { id: jobId },
  } = req

  if (company === '' || position === '') {
    throw new BadRequestError('Company or Position fields cannot be empty')
  }
  const job = await Job.findByIdAndUpdate(
    { _id: jobId, createdBy: userId },
    req.body,
    { new: true, runValidators: true }
  )
  if (!job) {
    throw new NotFoundError(`No job with id ${jobId}`)
  }
  res.status(StatusCodes.OK).json({ job })
}

const deleteJob = async (req, res) => {
  const {
    user: { userId },
    params: { id: jobId },
  } = req

  const job = await Job.findByIdAndRemove({
    _id: jobId,
    createdBy: userId,
  })
  if (!job) {
    throw new NotFoundError(`No job with id ${jobId}`)
  }
  res.status(StatusCodes.OK).send()
}

//group data by certain criterias, so we use mongoDB aggregation pipeline,
//we pass documents from one stage to another , filter and aggregate based on certain operators 
const showStats = async (req, res) => {

  //aggregate the match , match the jobs belonging to the user
  //group it by status and count , use the special sum operator 
  let stats = await Job.aggregate([
    { $match: { createdBy: mongoose.Types.ObjectId(req.user.userId) } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  //reduce used to refactor the array from stats above
  stats = stats.reduce((acc, curr) => {
    const { _id: title, count } = curr;
    acc[title] = count;
    return acc;
  }, {});

  const defaultStats = {
    pending: stats.pending || 0,
    interview: stats.interview || 0,
    declined: stats.declined || 0,
  };

  let monthlyApplications = await Job.aggregate([
    { $match: { createdBy: mongoose.Types.ObjectId(req.user.userId) } },
    //group your apps based on month and year for your data to be sent to frontend
    {
      $group: {
        _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
        count: { $sum: 1 },
      },
    },
    //sort it in descending order
    { $sort: { "_id.year": -1, "_id.month": -1 } },
    //limmit the amount of data to last 6 months
    { $limit: 6 },
  ]);

  //build array in format in which the frontend expects 
  monthlyApplications = monthlyApplications
    .map((item) => {
      const {
        _id: { year, month },
        count,
      } = item;
      //format in which the frontend expects it 
      const date = moment()
        .month(month - 1)
        .year(year)
        .format("MMM Y");
      return { date, count };
    })
    .reverse();

  res.status(StatusCodes.OK).json({ defaultStats, monthlyApplications });
};

module.exports = {
  createJob,
  deleteJob,
  getAllJobs,
  updateJob,
  getJob,
  showStats,
};
