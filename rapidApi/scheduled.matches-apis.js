//API-dojo

const options = {
  method: "GET",
  url: "https://sofascore.p.rapidapi.com/tournaments/get-scheduled-events",
  params: {
    categoryId: "1",
    date: "2025-09-27",
  },
  headers: {
    "x-rapidapi-key": "a2e0410905msh54d2e36ec6ced44p1e27b3jsnd966f1dce244",
    "x-rapidapi-host": "sofascore.p.rapidapi.com",
  },
};

try {
  const response = await axios.request(options);
  console.log(response.data);
} catch (error) {
  console.error(error);
}

// sport-real-time

const options2 = {
  method: "GET",
  url: "https://sport-api-real-time.p.rapidapi.com/tournaments/scheduled-events",
  params: {
    categoryId: "1",
    date: "2025-09-27",
  },
  headers: {
    "x-rapidapi-key": "a2e0410905msh54d2e36ec6ced44p1e27b3jsnd966f1dce244",
    "x-rapidapi-host": "sport-api-real-time.p.rapidapi.com",
  },
};

try {
  const response = await axios.request(options);
  console.log(response.data);
} catch (error) {
  console.error(error);
}

//sofa-api

const options3 = {
  method: "GET",
  url: "https://sportapi7.p.rapidapi.com/api/v1/sport/football/scheduled-events/2025-09-27",
  headers: {
    "x-rapidapi-key": "a2e0410905msh54d2e36ec6ced44p1e27b3jsnd966f1dce244",
    "x-rapidapi-host": "sportapi7.p.rapidapi.com",
  },
};

try {
  const response = await axios.request(options);
  console.log(response.data);
} catch (error) {
  console.error(error);
}

//sofascore.com

url =
  "https://www.sofascore.com/api/v1/sport/football/scheduled-events/2025-09-27";

  
  
  // sofascore found 2025-12-02
  
  const options4 = {
    method: "GET",
    url: "https://sofascore-sport-api.p.rapidapi.com/api/sport/football/scheduled-events/2025-12-03",
    headers: {
      "x-rapidapi-key": "adb090d6e6msh09b5af9b62cab53p18ec97jsnf66f393501ab",
      "x-rapidapi-host": "sofascore-sport-api.p.rapidapi.com",
    },
  };

  try {
    const response = await axios.request(options);
    console.log(response.data);
  } catch (error) {
    console.error(error);
  }