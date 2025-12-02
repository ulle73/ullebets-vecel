// API-dojo

const options = {
  method: "GET",
  url: "https://sofascore.p.rapidapi.com/matches/get-all-odds",
  params: { matchId: "8897222" },
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

//sport-real-time

const options2 = {
  method: "GET",
  url: "https://sport-api-real-time.p.rapidapi.com/matches/all-odds",
  params: {
    matchId: "14025184",
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
  url: "https://sportapi7.p.rapidapi.com/api/v1/event/14025184/odds/1/all",
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

url = "https://www.sofascore.com/api/v1/event/14025184/odds/1/all";



// SofaSport new 2025-10-31
const options4 = {
  method: "GET",
  url: "https://sofasport.p.rapidapi.com/v1/events/odds/all",
  params: {
    event_id: "14025184",
    provider_id: "1",
    odds_format: "decimal",
  },
  headers: {
    "x-rapidapi-key": "d26361d6a1msh55def5349c5e57dp1eaee1jsn74e247833a6e",
    "x-rapidapi-host": "sofasport.p.rapidapi.com",
  },
};

try {
  const response = await axios.request(options);
  console.log(response.data);
} catch (error) {
  console.error(error);
}



// sofascore found 2025-12-02

const options5 = {
  method: "GET",
  url: "https://sofascore-sport-api.p.rapidapi.com/api/event/14566745/odds/1/all",
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